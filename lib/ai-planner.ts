// AI week planning: GPT does the thinking (composition, taste, judgment,
// deal-match auditing), the deterministic engine does the arithmetic
// (real totals, hard budget verdict). AI proposes — code audits.
//
// Any failure at any step falls back to the deterministic planner with an
// honest note; AI mode can never produce silently-wrong numbers because all
// totals are recomputed from the same data the deterministic path uses.

import { askJson } from "./ai";
import {
  assembleResult,
  type EnrichedRecipe,
  enrichRecipes,
  type MealType,
  mealTypeOf,
  type PlanDay,
  type PlannedMeal,
  type PlanResult,
  type PlanWeekOptions,
} from "./planner";
import type { Recipe } from "./store";

export interface AiPlanExtras {
  used: boolean;
  model?: string;
  reasoning?: string;
  tips?: string[];
  rejectedDeals?: Array<{ recipe: string; ingredient: string; reason: string }>;
  error?: string;
}

interface AiPlanResponse {
  days: Array<{ day: number; meals: Array<{ mealType: string; recipe: string }> }>;
  rejectedDeals?: Array<{ recipe: string; ingredient: string; reason: string }>;
  reasoning?: string;
  tips?: string[];
}

function describeRecipe(e: EnrichedRecipe): string {
  const deals = e.scored.ingredients
    .filter((i) => i.bestDeal)
    .map(
      (i) =>
        `${i.name}→"${i.bestDeal?.heading}" ${Math.round(i.bestDeal?.price ?? 0)}kr@${i.bestDeal?.store}${i.confidence === "low" ? "(usikkert match)" : ""}`,
    )
    .join("; ");
  const kcal = e.nutrition.perServing ? `${e.nutrition.perServing.kcal} kcal/pers` : "kcal ukendt";
  const prep = e.recipe.batchable
    ? `batchable, holder ${e.recipe.keepsDays ?? 0} dage`
    : "ikke batch-egnet";
  return `- "${e.scored.name}" [${mealTypeOf(e)}] ~${Math.round(e.fullCost)}kr/måltid, ${kcal}, ${e.scored.proteinType}/${e.scored.cuisineType}, ${e.scored.complexity}, ${prep}. tilbud: ${deals || "ingen"}`;
}

const SYSTEM_PROMPT = `Du er en omhyggelig dansk madplanlægger. Du får en pulje af opskrifter med RIGTIGE priser fra ugens tilbudsaviser, og du sammensætter ugens måltider med sund fornuft: variation hen over ugen, sammenhæng mellem dagene, rester der giver mening, årstids- og hverdagslogik, og respekt for brugerens ønsker. Budgettet er et HÅRDT loft — vælg billigt nok til at holde dig under det med margin.

Du skal OGSÅ auditere tilbudsmatchene: hvis en ingrediens er matchet til et tilbud der åbenlyst er en anden vare (fx "porre" matchet til "farsbrød af gris med porre", eller et kødprodukt i en vegetarret), så afvis matchet i rejectedDeals — varen bliver så prissat som basisvare i stedet.

Svar KUN med gyldig JSON i præcis denne form:
{"days":[{"day":1,"meals":[{"mealType":"dinner","recipe":"<eksakt opskriftsnavn fra puljen>"}]}],"rejectedDeals":[{"recipe":"...","ingredient":"...","reason":"kort begrundelse"}],"reasoning":"2-4 sætninger om dine valg","tips":["korte praktiske råd"]}

Regler: brug KUN opskriftsnavne der står ordret i puljen; hver dag skal have præcis de efterspurgte måltidstyper; en opskrift må gerne gentages hvis puljen er lille, men sig det i reasoning.`;

function buildUserPrompt(
  poolByMeal: Map<MealType, EnrichedRecipe[]>,
  opts: PlanWeekOptions,
  wishes: string | undefined,
  repairNote: string | undefined,
): string {
  const parts: string[] = [];
  parts.push(
    `Planlæg ${opts.days} dage for ${opts.people} personer. Måltider pr. dag: ${opts.meals.join(", ")}. HÅRDT budgetloft: ${opts.budget} kr for hele planen (tilbudsvarer + basisvarer).`,
  );
  if (opts.kcalPerPersonPerDay) {
    parts.push(
      `Kaloriemål: ${opts.kcalPerPersonPerDay} kcal/person/dag for HELE dagen — de planlagte måltider skal ramme deres rimelige andel (morgenmad ~25%, frokost ~35%, aftensmad ~40%), ±10%.`,
    );
  }
  if (opts.constraints.excludeProteins?.length) {
    parts.push(
      `Udelukkelser (må IKKE forekomme, heller ikke som ingrediens): ${opts.constraints.excludeProteins.join(", ")}.`,
    );
  }
  if (wishes?.trim()) {
    parts.push(`Brugerens egne ønsker (vigtige): ${wishes.trim()}`);
  }
  if (repairNote) {
    parts.push(`RETTELSE PÅKRÆVET: ${repairNote}`);
  }
  for (const meal of opts.meals) {
    const pool = poolByMeal.get(meal) ?? [];
    parts.push(
      `\nPulje for ${meal} (${pool.length} opskrifter):\n${pool.map(describeRecipe).join("\n")}`,
    );
  }
  return parts.join("\n");
}

/** Drop AI-rejected deal matches and re-derive costs deterministically. */
function applyDealRejections(
  e: EnrichedRecipe,
  rejectedIngredients: Set<string>,
  recipes: Recipe[],
  householdSize: number,
  pantrySet: Set<string>,
): EnrichedRecipe {
  if (rejectedIngredients.size === 0) return e;
  const strippedScored = {
    ...e.scored,
    ingredients: e.scored.ingredients.map((i) =>
      rejectedIngredients.has(i.name.toLowerCase())
        ? { ...i, bestDeal: null, estimatedCost: 0, confidence: "none" as const }
        : i,
    ),
  };
  strippedScored.estimatedCost =
    Math.round(
      strippedScored.ingredients.reduce((s, i) => s + (i.bestDeal ? i.estimatedCost : 0), 0) * 100,
    ) / 100;
  const [reEnriched] = enrichRecipes([strippedScored], recipes, householdSize, pantrySet);
  return reEnriched ?? e;
}

export interface AiPlanInput {
  pool: EnrichedRecipe[];
  opts: PlanWeekOptions;
  wishes?: string;
  recipes: Recipe[];
  pantrySet: Set<string>;
}

export type AiPlanOutcome =
  | { ok: true; result: PlanResult; extras: AiPlanExtras }
  | { ok: false; error: string };

/**
 * Ask the model to compose the week, then rebuild the plan deterministically
 * from its picks so every number is real. One repair round if over budget.
 */
export async function aiPlanWeek(input: AiPlanInput): Promise<AiPlanOutcome> {
  const { opts, wishes } = input;
  if (opts.mealPrep) {
    return {
      ok: false,
      error: "ai-tilstand understøtter ikke meal prep endnu (deterministisk plan bruges)",
    };
  }

  const poolByMeal = new Map<MealType, EnrichedRecipe[]>();
  for (const meal of opts.meals) {
    const pool = input.pool.filter((e) => mealTypeOf(e) === meal);
    if (pool.length === 0) return { ok: false, error: `ingen opskrifter til ${meal}` };
    poolByMeal.set(meal, pool);
  }

  let repairNote: string | undefined;
  let lastExtras: AiPlanExtras = { used: true };
  let best: { result: PlanResult; extras: AiPlanExtras } | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await askJson<AiPlanResponse>(
      SYSTEM_PROMPT,
      buildUserPrompt(poolByMeal, opts, wishes, repairNote),
    );
    if (!response.ok) return { ok: false, error: response.error };

    const built = buildFromAiResponse(response.value, poolByMeal, input);
    if (!built.ok) {
      // Malformed picks: one retry with the validation error as repair note.
      repairNote = built.error;
      lastExtras = { used: true, model: response.model, error: built.error };
      continue;
    }

    const extras: AiPlanExtras = {
      used: true,
      model: response.model,
      reasoning: response.value.reasoning,
      tips: response.value.tips?.slice(0, 6),
      rejectedDeals: response.value.rejectedDeals?.slice(0, 20),
    };
    if (built.result.feasible) {
      return { ok: true, result: built.result, extras };
    }
    // Over budget: keep it as candidate, ask the model to repair once.
    if (!best || built.result.grandTotal < best.result.grandTotal) {
      best = { result: built.result, extras };
    }
    repairNote = `din plan blev beregnet til ~${built.result.grandTotal} kr — det er ${Math.ceil(built.result.budgetGap)} kr OVER loftet på ${opts.budget} kr. Vælg billigere opskrifter (lavest kr/måltid) til flere af dagene.`;
  }

  if (best) {
    best.result.notes.push(
      "ai-planen endte over budget efter 2 forsøg — tallene her er efterregnet og ærlige",
    );
    return { ok: true, result: best.result, extras: best.extras };
  }
  return { ok: false, error: lastExtras.error ?? "ai gav ugyldige opskriftsvalg to gange" };
}

function buildFromAiResponse(
  response: AiPlanResponse,
  poolByMeal: Map<MealType, EnrichedRecipe[]>,
  input: AiPlanInput,
): { ok: true; result: PlanResult } | { ok: false; error: string } {
  const { opts } = input;
  if (!Array.isArray(response.days) || response.days.length !== opts.days) {
    return { ok: false, error: `svaret skal have præcis ${opts.days} dage i "days"` };
  }

  const rejectedByRecipe = new Map<string, Set<string>>();
  for (const r of response.rejectedDeals ?? []) {
    const set = rejectedByRecipe.get(r.recipe) ?? new Set<string>();
    set.add(r.ingredient.toLowerCase());
    rejectedByRecipe.set(r.recipe, set);
  }

  const byName = new Map<string, EnrichedRecipe>();
  for (const pool of poolByMeal.values()) {
    for (const e of pool) byName.set(`${mealTypeOf(e)}|${e.scored.name.toLowerCase()}`, e);
  }

  const days: PlanDay[] = [];
  const sortedDays = [...response.days].sort((a, b) => a.day - b.day);
  for (let d = 0; d < opts.days; d++) {
    const dayPlan = sortedDays[d];
    const meals: PlannedMeal[] = [];
    for (const mealType of opts.meals) {
      const pick = dayPlan?.meals?.find((m) => m.mealType === mealType);
      if (!pick) return { ok: false, error: `dag ${d + 1} mangler ${mealType}` };
      let recipe = byName.get(`${mealType}|${pick.recipe.toLowerCase().trim()}`);
      if (!recipe) {
        return {
          ok: false,
          error: `"${pick.recipe}" findes ikke i puljen for ${mealType} — brug de eksakte navne`,
        };
      }
      const rejected = rejectedByRecipe.get(recipe.scored.name);
      if (rejected && rejected.size > 0) {
        recipe = applyDealRejections(recipe, rejected, input.recipes, opts.people, input.pantrySet);
      }
      meals.push({ mealType, recipe, leftover: false, cookedOnDay: d + 1 });
    }
    const kcals = meals
      .map((m) => m.recipe.nutrition.perServing?.kcal ?? null)
      .filter((k): k is number => k !== null);
    days.push({
      day: d + 1,
      meals,
      kcalPerPerson: kcals.length > 0 ? kcals.reduce((a, b) => a + b, 0) : null,
    });
  }

  return { ok: true, result: assembleResult(days, opts, []) };
}
