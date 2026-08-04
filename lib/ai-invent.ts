// AI-invented week planning: no recipe library. GPT sees the week's REAL
// deals and invents the meals around them ("ristede grøntsager med kylling
// og ris" is a recipe); the deterministic engine then prices every invented
// ingredient with the same deal-matching + baseline + nutrition machinery
// as everything else, so no number is ever the model's word alone.
//
// Budget is a HARD cap: over-budget plans get GPT repair rounds, and if the
// model still can't land under, a deterministic trim pass swaps expensive
// slots to the week's cheapest invented meal until the plan fits.
//
// Condiments/seasonings land in a separate "maybe" basket (people may have
// them or need to buy them) — priced as estimates, never counted in the cap.

import { askJson } from "./ai";
import { searchDealsBatch } from "./api";
import { findBaselineItem } from "./baseline";
import type { Locale } from "./locales";
import {
  assembleResult,
  type CookBlock,
  type EnrichedRecipe,
  enrichRecipes,
  type MaybeBucket,
  type MealType,
  type PlanDay,
  type PlannedMeal,
  type PlanResult,
  type PlanWeekOptions,
} from "./planner";
import { findExcludedTag, NON_INGREDIENT_INDICATORS, type ScoredRecipe } from "./scoring";
import type { Ingredient, Recipe } from "./store";
import { scoreOneRecipe } from "./tools/scoring";

export interface AiPlanExtras {
  used: boolean;
  model?: string;
  reasoning?: string;
  tips?: string[];
  rejectedDeals?: Array<{ recipe: string; ingredient: string; reason: string }>;
  error?: string;
}

export type AiPlanOutcome =
  | { ok: true; result: PlanResult; extras: AiPlanExtras }
  | { ok: false; error: string };

// --- Deal sweep ---

/** Broad everyday-food terms so the model sees the whole week's deal landscape. */
const SWEEP_TERMS = [
  "kylling",
  "kyllingebryst",
  "hakket oksekød",
  "hakket svinekød",
  "svinekød",
  "laks",
  "torsk",
  "æg",
  "tofu",
  "kikærter",
  "linser",
  "bønner",
  "ris",
  "pasta",
  "kartofler",
  "rugbrød",
  "havregryn",
  "tortilla",
  "løg",
  "hvidløg",
  "gulerødder",
  "tomater",
  "peberfrugt",
  "broccoli",
  "blomkål",
  "spidskål",
  "hvidkål",
  "squash",
  "champignon",
  "salat",
  "agurk",
  "spinat",
  "porrer",
  "æbler",
  "bananer",
  "appelsiner",
  "ost",
  "yoghurt",
  "skyr",
  "mælk",
  "frosne grøntsager",
];

/** Max deal lines shown to the model — enough landscape, bounded tokens. */
const CATALOG_LIMIT = 150;

interface CatalogEntry {
  heading: string;
  price: number;
  store: string;
  quantity: number | null;
  unit: string | null;
  pricePerUnit: string | null;
}

function foodish(heading: string): boolean {
  const h = heading.toLowerCase();
  return !NON_INGREDIENT_INDICATORS.some((w) => h.includes(w));
}

export function buildDealCatalog(dealMap: Map<string, import("./api").Offer[]>): CatalogEntry[] {
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const offers of dealMap.values()) {
    for (const o of offers) {
      if (o.price === null || o.price <= 0) continue;
      if (seen.has(o.id)) continue;
      if (!foodish(o.heading)) continue;
      seen.add(o.id);
      entries.push({
        heading: o.heading,
        price: o.price,
        store: o.store,
        quantity: o.quantity,
        unit: o.unit,
        pricePerUnit: o.pricePerUnit,
      });
    }
  }
  // Cheapest sticker price first — the model reads top-down.
  entries.sort((a, b) => a.price - b.price);
  return entries.slice(0, CATALOG_LIMIT);
}

function formatCatalog(entries: CatalogEntry[]): string {
  return entries
    .map((e) => {
      const qty = e.quantity && e.unit ? ` (${e.quantity} ${e.unit})` : "";
      const per = e.pricePerUnit ? `, ${e.pricePerUnit}` : "";
      return `- ${e.heading}${qty} — ${e.price} kr @ ${e.store}${per}`;
    })
    .join("\n");
}

// --- Maybe classification (condiments & seasonings) ---

/** Words that mark an ingredient as a have-it-or-buy-it condiment/seasoning. */
const MAYBE_WORDS = [
  "salt",
  "peber",
  "krydderi",
  "karry",
  "paprika",
  "spidskommen",
  "oregano",
  "basilikum",
  "timian",
  "rosmarin",
  "chiliflager",
  "kanel",
  "kardemomme",
  "vanilje",
  "bouillon",
  "olie",
  "olivenolie",
  "rapsolie",
  "eddike",
  "soja",
  "sojasauce",
  "fishsauce",
  "østerssauce",
  "sennep",
  "ketchup",
  "mayonnaise",
  "remoulade",
  "honning",
  "sirup",
  "sukker",
  "bagepulver",
  "natron",
  "gær",
];

export function isMaybeIngredient(ing: {
  name: string;
  category?: string;
  maybe?: boolean;
}): boolean {
  if (ing.maybe === true) return true;
  const cat = (ing.category ?? "").toLowerCase();
  if (cat === "condiment" || cat === "spice" || cat === "krydderi") return true;
  const name = ing.name.toLowerCase();
  return MAYBE_WORDS.some((w) => name === w || name.includes(w));
}

export function buildMaybeBucket(
  items: Array<{ name: string; searchTerms: string[] }>,
  pantrySet: Set<string>,
): MaybeBucket {
  const byName = new Map<string, { name: string; estimate: number | null }>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    if (pantrySet.has(key)) continue; // declared pantry = definitely have it
    if (byName.has(key)) continue;
    const baseline = findBaselineItem({ name: item.name, searchTerms: item.searchTerms });
    byName.set(key, { name: item.name, estimate: baseline ? baseline.estimatePrice : null });
  }
  const lines = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const total = Math.round(lines.reduce((sum, l) => sum + (l.estimate ?? 0), 0));
  return { lines, total };
}

// --- Model IO ---

interface AiIngredientJson {
  name: string;
  quantity: string;
  searchTerms?: string[];
  category?: string;
  maybe?: boolean;
}

interface AiMealJson {
  mealType: string;
  name: string;
  leftoverOf?: number | null;
  ingredients?: AiIngredientJson[];
}

interface AiInventResponse {
  days: Array<{ day: number; meals: AiMealJson[] }>;
  reasoning?: string;
  tips?: string[];
}

const SYSTEM_PROMPT = `Du er en kreativ og EKSTREMT sparsommelig dansk madplanlægger. Du OPFINDER selv ugens måltider fra bunden ud fra RIGTIGE tilbud fra ugens tilbudsaviser — der er ingen opskriftsbog. Simpel rigtig mad er helt fint: "ristede grøntsager med kylling og ris" er en ret. Målet er at bruge FÆRREST MULIGE penge i supermarkedet og lande KLART UNDER det hårde budgetloft.

Sådan tænker du: start i tilbudslisten, byg måltiderne omkring de billigste brugbare tilbud, genbrug ingredienser hen over ugen (én pose ris, ét bundt gulerødder rækker flere dage — men mængderne du skriver er PR. MÅLTID), og fyld op med billige basisvarer (havregryn, ris, linser, kål, æg, sæsongrønt) hvor tilbuddene ikke rækker. Rester er et værktøj: leftoverOf = dag-nummeret hvis måltidet er rester af samme måltidstype fra en tidligere dag (så udelades ingredients).

Regler for ingredienser:
- quantity = SAMLET mængde til ALLE personer for DET ENE måltid, altid i formatet "<tal> g", "<tal> ml" eller "<tal> stk".
- searchTerms: 1-3 danske grundord til tilbuds- og næringsmatch ("kylling", "ris", "løg").
- category: meat, fish, dairy, produce, bakery, frozen, pantry eller other.
- maybe: true for krydderier, olie, eddike, sennep, soja, bouillon og lignende småting folk ofte har i forvejen — de ender i en separat "måske"-kurv uden for budgettet. Salt og peber skal slet ikke listes.
- Kostudelukkelser er ABSOLUTTE (allergi/sygdom) — må ikke forekomme i nogen ingrediens overhovedet.

Svar KUN med gyldig JSON i præcis denne form:
{"days":[{"day":1,"meals":[{"mealType":"dinner","name":"<kort retnavn>","leftoverOf":null,"ingredients":[{"name":"...","quantity":"400 g","searchTerms":["..."],"category":"produce","maybe":false}]}]}],"reasoning":"2-4 sætninger om dine valg og hvor pengene spares","tips":["korte praktiske råd"]}`;

export interface InventInput {
  opts: PlanWeekOptions;
  wishes?: string;
  pantrySet: Set<string>;
  locale: Locale;
  preferredStores: Set<string>;
  maxCookMinutes?: number;
}

function buildUserPrompt(
  input: InventInput,
  catalog: CatalogEntry[],
  repairNote: string | undefined,
): string {
  const { opts, wishes, pantrySet, maxCookMinutes } = input;
  const parts: string[] = [];
  parts.push(
    `Opfind ${opts.days} dages mad for ${opts.people} person(er). Måltider pr. dag: ${opts.meals.join(", ")}. HÅRDT budgetloft: ${opts.budget} kr for hele planen (tilbudsvarer + basisvarer; måske-kurven tæller ikke med). Sigt efter at lande et pænt stykke UNDER loftet.`,
  );
  if (opts.kcalPerPersonPerDay) {
    parts.push(
      `Kaloriemål: ${opts.kcalPerPersonPerDay} kcal/person/dag for HELE dagen — planlagte måltider skal ramme deres andel (morgenmad ~25%, frokost ~35%, aftensmad ~40%), ±10%. Billig mad må ikke betyde for lidt mad.`,
    );
  }
  if (opts.constraints.excludeProteins?.length) {
    parts.push(`Udelukkelser (ABSOLUTTE): ${opts.constraints.excludeProteins.join(", ")}.`);
  }
  if (maxCookMinutes) {
    parts.push(`Max tilberedningstid pr. ret: ~${maxCookMinutes} min.`);
  }
  if (opts.mealPrep) {
    const cookDays = (opts.cookDays ?? [1, 4]).join(" og ");
    parts.push(
      `MEAL PREP: brugeren vil helst kun lave mad på dag ${cookDays} — brug leftoverOf flittigt så andre dage er rester.`,
    );
  }
  if (pantrySet.size > 0) {
    parts.push(
      `Brugeren HAR allerede (gratis, brug dem gerne): ${[...pantrySet].sort().join(", ")}.`,
    );
  }
  if (wishes?.trim()) {
    parts.push(`Brugerens egne ønsker (vigtige): ${wishes.trim()}`);
  }
  if (repairNote) {
    parts.push(`RETTELSE PÅKRÆVET: ${repairNote}`);
  }
  parts.push(`\nUgens tilbud (billigste først):\n${formatCatalog(catalog)}`);
  return parts.join("\n");
}

// --- Validation & normalization ---

interface NormalizedMeal {
  mealType: MealType;
  name: string;
  leftoverOf: number | null;
  ingredients: AiIngredientJson[];
}

type NormalizedDays = NormalizedMeal[][]; // [dayIndex][mealIndex]

export function normalizeInventResponse(
  response: AiInventResponse,
  opts: PlanWeekOptions,
): { ok: true; days: NormalizedDays } | { ok: false; error: string } {
  if (!Array.isArray(response.days) || response.days.length !== opts.days) {
    return { ok: false, error: `svaret skal have præcis ${opts.days} dage i "days"` };
  }
  const sorted = [...response.days].sort((a, b) => a.day - b.day);
  const days: NormalizedDays = [];

  for (let d = 0; d < opts.days; d++) {
    const meals: NormalizedMeal[] = [];
    for (const mealType of opts.meals) {
      const pick = sorted[d]?.meals?.find((m) => m.mealType === mealType);
      if (!pick) return { ok: false, error: `dag ${d + 1} mangler ${mealType}` };
      if (typeof pick.name !== "string" || pick.name.trim() === "") {
        return { ok: false, error: `dag ${d + 1} ${mealType} mangler et retnavn` };
      }
      const leftoverOf =
        typeof pick.leftoverOf === "number" && Number.isInteger(pick.leftoverOf)
          ? pick.leftoverOf
          : null;
      if (leftoverOf !== null) {
        if (leftoverOf < 1 || leftoverOf > d) {
          return {
            ok: false,
            error: `dag ${d + 1} ${mealType}: leftoverOf=${leftoverOf} skal pege på en TIDLIGERE dag`,
          };
        }
        const source = days[leftoverOf - 1]?.find((m) => m.mealType === mealType);
        if (!source || source.leftoverOf !== null) {
          return {
            ok: false,
            error: `dag ${d + 1} ${mealType}: leftoverOf=${leftoverOf} peger ikke på et rigtigt tilberedt ${mealType}`,
          };
        }
        meals.push({ mealType, name: source.name, leftoverOf, ingredients: [] });
        continue;
      }
      const ingredients = Array.isArray(pick.ingredients) ? pick.ingredients : [];
      const real = ingredients.filter(
        (i) =>
          typeof i?.name === "string" && i.name.trim() !== "" && typeof i?.quantity === "string",
      );
      if (real.length === 0) {
        return {
          ok: false,
          error: `dag ${d + 1} ${mealType} ("${pick.name}") mangler ingredienser`,
        };
      }
      meals.push({ mealType, name: pick.name.trim(), leftoverOf: null, ingredients: real });
    }
    days.push(meals);
  }
  return { ok: true, days };
}

function toIngredient(i: AiIngredientJson): Ingredient {
  const name = i.name.trim();
  const terms = (i.searchTerms ?? [])
    .filter((t) => typeof t === "string" && t.trim() !== "")
    .map((t) => t.trim().toLowerCase());
  return {
    name,
    quantity: i.quantity.trim(),
    searchTerms: terms.length > 0 ? terms : [name.toLowerCase()],
    category: (i.category ?? "other").toLowerCase(),
  };
}

/** Invented meals → Recipe objects (maybe-items stripped into the bucket). */
export function buildInventedRecipes(
  days: NormalizedDays,
  people: number,
): { recipes: Recipe[]; maybeItems: Array<{ name: string; searchTerms: string[] }> } {
  const byName = new Map<string, Recipe>();
  const maybeItems: Array<{ name: string; searchTerms: string[] }> = [];
  for (const dayMeals of days) {
    for (const meal of dayMeals) {
      if (meal.leftoverOf !== null || byName.has(meal.name)) continue;
      const core: Ingredient[] = [];
      for (const raw of meal.ingredients) {
        const ing = toIngredient(raw);
        if (isMaybeIngredient({ ...raw, name: ing.name })) {
          maybeItems.push({ name: ing.name, searchTerms: ing.searchTerms });
        } else {
          core.push(ing);
        }
      }
      if (core.length === 0) continue;
      byName.set(meal.name, {
        name: meal.name,
        ingredients: core,
        // Quantities are already household totals for one meal → servings =
        // household size makes every scaling factor 1 and kcal come out
        // per person.
        servings: people,
        complexity: "medium",
        cuisineType: "ai",
        proteinType: "mixed",
        mealType: meal.mealType,
      });
    }
  }
  return { recipes: [...byName.values()], maybeItems };
}

// Plant-based analogs that substring-match animal patterns ("kokosMÆLK" hits
// the dairy tag "mælk") — stripped from names before the exclusion check so
// dairy-free/vegan inventions aren't rejected as violations.
const PLANT_ANALOGS = [
  "kokosmælk",
  "havremælk",
  "sojamælk",
  "mandelmælk",
  "rismælk",
  "risdrik",
  "havredrik",
  "sojadrik",
  "mandeldrik",
  "plantefløde",
  "havrefløde",
  "sojafløde",
  "kokosfløde",
  "jordnøddesmør",
  "peanutbutter",
  "mandelsmør",
];

export function stripPlantAnalogs(name: string): string {
  let out = name.toLowerCase();
  for (const analog of PLANT_ANALOGS) {
    out = out.replaceAll(analog, "");
  }
  return out;
}

// --- Plan building ---

function buildPlanDays(
  days: NormalizedDays,
  enrichedByName: Map<string, EnrichedRecipe>,
): PlanDay[] {
  return days.map((dayMeals, d) => {
    const meals: PlannedMeal[] = dayMeals.map((m) => {
      const recipe = enrichedByName.get(m.name);
      if (!recipe) throw new Error(`invented recipe missing after enrichment: ${m.name}`);
      return {
        mealType: m.mealType,
        recipe,
        leftover: m.leftoverOf !== null,
        cookedOnDay: m.leftoverOf ?? d + 1,
      };
    });
    const kcals = meals
      .map((m) => m.recipe.nutrition.perServing?.kcal ?? null)
      .filter((k): k is number => k !== null);
    return {
      day: d + 1,
      meals,
      kcalPerPerson: kcals.length > 0 ? kcals.reduce((a, b) => a + b, 0) : null,
    };
  });
}

function buildCookSchedule(days: PlanDay[]): CookBlock[] {
  const blocks = new Map<string, CookBlock>();
  for (const day of days) {
    for (const meal of day.meals) {
      const key = `${meal.recipe.scored.name}|${meal.mealType}|${meal.cookedOnDay}`;
      const block = blocks.get(key) ?? {
        day: meal.cookedOnDay,
        mealType: meal.mealType,
        recipeName: meal.recipe.scored.name,
        portions: 0,
        covers: [],
      };
      block.covers.push(day.day);
      blocks.set(key, block);
    }
  }
  return [...blocks.values()]
    .sort((a, b) => a.day - b.day || a.mealType.localeCompare(b.mealType))
    .map((b) => ({ ...b, portions: b.covers.length }));
}

/**
 * Deterministic hard-cap trim: swap the most expensive freshly-cooked slots
 * to the cheapest invented meal of the same meal type until the plan fits.
 * Mutates a copy of the day structure; returns null when nothing else can
 * be swapped.
 */
export function trimToBudget(
  days: NormalizedDays,
  enrichedByName: Map<string, EnrichedRecipe>,
  opts: PlanWeekOptions,
  buildResult: (days: NormalizedDays) => PlanResult,
): { result: PlanResult; swaps: number } | null {
  const cheapestFor = new Map<MealType, string>();
  for (const mealType of opts.meals) {
    let best: { name: string; cost: number } | null = null;
    for (const [name, e] of enrichedByName) {
      if ((e.recipe.mealType ?? "dinner") !== mealType) continue;
      if (!best || e.fullCost < best.cost) best = { name, cost: e.fullCost };
    }
    if (best) cheapestFor.set(mealType, best.name);
  }

  const work: NormalizedDays = days.map((dm) => dm.map((m) => ({ ...m })));
  let swaps = 0;
  for (let guard = 0; guard < work.length * opts.meals.length; guard++) {
    const result = buildResult(work);
    if (result.budgetGap === 0) return swaps > 0 ? { result, swaps } : { result, swaps: 0 };

    // Most expensive freshly-cooked, not-already-cheapest slot.
    let target: { d: number; m: number; cost: number } | null = null;
    for (let d = 0; d < work.length; d++) {
      for (let m = 0; m < work[d].length; m++) {
        const meal = work[d][m];
        if (meal.leftoverOf !== null) continue;
        const cheapest = cheapestFor.get(meal.mealType);
        if (!cheapest || meal.name === cheapest) continue;
        const cost = enrichedByName.get(meal.name)?.fullCost ?? 0;
        if (!target || cost > target.cost) target = { d, m, cost };
      }
    }
    if (!target) return null; // everything is already the cheapest meal
    const swapped = work[target.d][target.m];
    const cheapest = cheapestFor.get(swapped.mealType);
    if (!cheapest) return null;
    work[target.d][target.m] = { ...swapped, name: cheapest, leftoverOf: null, ingredients: [] };
    // Leftovers of the swapped cook follow it, so "rest af X" never points
    // at a day that now cooks something else.
    for (const dayMeals of work) {
      for (let m = 0; m < dayMeals.length; m++) {
        const meal = dayMeals[m];
        if (
          meal.leftoverOf === target.d + 1 &&
          meal.mealType === swapped.mealType &&
          meal.name === swapped.name
        ) {
          dayMeals[m] = { ...meal, name: cheapest };
        }
      }
    }
    swaps++;
  }
  return null;
}

// --- Entry point ---

const MAX_ATTEMPTS = 3;
// Stay inside the route's 300s cap: no new GPT attempt starts unless this
// much of the total budget is still left for it.
const TOTAL_BUDGET_MS = 280_000;
const PER_ATTEMPT_MS = 155_000;

export async function aiInventWeek(input: InventInput): Promise<AiPlanOutcome> {
  const { opts, locale, pantrySet, preferredStores } = input;
  const startedAt = Date.now();

  const sweepMap = await searchDealsBatch(SWEEP_TERMS, 8, locale.country);
  const catalog = buildDealCatalog(sweepMap);
  if (catalog.length === 0) {
    return { ok: false, error: "ingen tilbud fundet at bygge madplanen af" };
  }

  let repairNote: string | undefined;
  let lastError = "ai gav ugyldige svar";
  let best: { result: PlanResult; extras: AiPlanExtras } | null = null;
  // Kept from the latest good attempt so the trim pass can run after the loop.
  let lastGood: {
    days: NormalizedDays;
    enrichedByName: Map<string, EnrichedRecipe>;
    buildResult: (days: NormalizedDays) => PlanResult;
    extras: AiPlanExtras;
  } | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0 && Date.now() - startedAt > TOTAL_BUDGET_MS - PER_ATTEMPT_MS) {
      break; // no room for another round — enforce the cap with what we have
    }
    const response = await askJson<AiInventResponse>(
      SYSTEM_PROMPT,
      buildUserPrompt(input, catalog, repairNote),
    );
    if (!response.ok) return { ok: false, error: response.error };

    const normalized = normalizeInventResponse(response.value, opts);
    if (!normalized.ok) {
      repairNote = normalized.error;
      lastError = normalized.error;
      continue;
    }

    const { recipes, maybeItems } = buildInventedRecipes(normalized.days, opts.people);
    if (recipes.length === 0) {
      repairNote = "hvert måltid skal have mindst én rigtig ingrediens (ikke kun krydderier)";
      lastError = repairNote;
      continue;
    }

    // Second targeted fetch: match the invented ingredients against deals.
    const terms = new Set<string>();
    for (const r of recipes) {
      for (const ing of r.ingredients) {
        for (const t of ing.searchTerms) terms.add(t);
      }
    }
    const targeted = await searchDealsBatch([...terms].slice(0, 150), 8, locale.country);
    const dealMap = new Map([...sweepMap, ...targeted]);

    const scored: ScoredRecipe[] = recipes.map((r) =>
      scoreOneRecipe(r, dealMap, preferredStores, pantrySet, opts.people, locale),
    );

    // Exclusions are absolute — a violating plan is never accepted.
    if (opts.constraints.excludeProteins?.length) {
      const violations = scored
        .map((s) => ({
          name: s.name,
          tag: findExcludedTag(
            s.ingredients.map((i) => ({ ...i, name: stripPlantAnalogs(i.name) })),
            opts.constraints.excludeProteins ?? [],
            opts.constraints.ingredientTags,
          ),
        }))
        .filter((v) => v.tag !== null);
      if (violations.length > 0) {
        repairNote = `disse retter bryder udelukkelserne og skal erstattes: ${violations
          .map((v) => `"${v.name}" (${v.tag})`)
          .join(", ")}`;
        lastError = repairNote;
        continue;
      }
    }

    const enriched = enrichRecipes(scored, recipes, opts.people, pantrySet);
    const enrichedByName = new Map(enriched.map((e) => [e.scored.name, e]));

    const maybe = buildMaybeBucket(maybeItems, pantrySet);
    const lowConfidence = scored.reduce(
      (n, s) => n + s.ingredients.filter((i) => i.confidence === "low").length,
      0,
    );

    const buildResult = (days: NormalizedDays): PlanResult => {
      const notes: string[] = [];
      const planDays = buildPlanDays(days, enrichedByName);
      const cookSchedule = opts.mealPrep ? buildCookSchedule(planDays) : undefined;
      const result = assembleResult(planDays, opts, notes, cookSchedule);
      result.maybe = maybe;
      if (lowConfidence > 0) {
        result.notes.push(
          `${lowConfidence} tilbudsmatch er usikre — priserne dér er bedste bud, ikke garantier`,
        );
      }
      return result;
    };

    const extras: AiPlanExtras = {
      used: true,
      model: response.model,
      reasoning: response.value.reasoning,
      tips: response.value.tips?.slice(0, 6),
    };
    const result = buildResult(normalized.days);
    if (result.feasible) {
      return { ok: true, result, extras };
    }

    lastGood = { days: normalized.days, enrichedByName, buildResult, extras };
    if (!best || result.grandTotal < best.result.grandTotal) {
      best = { result, extras };
    }
    repairNote = `din plan blev efterregnet til ~${result.grandTotal} kr — det er ${Math.ceil(result.budgetGap)} kr OVER det hårde loft på ${opts.budget} kr. Byg billigere: flere rester (leftoverOf), billigere tilbud, mere ris/havregryn/kål/linser.`;
    lastError = repairNote;
  }

  // The model couldn't land under the cap on its own — enforce it.
  if (lastGood) {
    const trimmed = trimToBudget(
      lastGood.days,
      lastGood.enrichedByName,
      opts,
      lastGood.buildResult,
    );
    if (trimmed?.result.feasible) {
      if (trimmed.swaps > 0) {
        trimmed.result.notes.push(
          `hårdt loft håndhævet: ${trimmed.swaps} måltid(er) skiftet til ugens billigste ret for at komme under budget`,
        );
      }
      return { ok: true, result: trimmed.result, extras: lastGood.extras };
    }
    if (best) {
      best.result.notes.push(
        "selv ugens billigste sammensætning kunne ikke komme under loftet — tallene her er efterregnede og ærlige",
      );
      return { ok: true, result: best.result, extras: best.extras };
    }
  }
  return { ok: false, error: lastError };
}
