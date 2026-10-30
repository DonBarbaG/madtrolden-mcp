// Shared plan_week pipeline — used by both the MCP tool (lib/tools/planner.ts)
// and the private web UI's JSON endpoint (app/api/plan/route.ts), so the two
// surfaces can never drift apart.

import { aiAvailable } from "./ai";
import { type AiPlanExtras, aiInventWeek } from "./ai-invent";
import { getLocale } from "./locales";
import { findStoresNear, type NearbyStores } from "./location";
import { matchOnHand, type OnHandItem, parseOnHand, tallyOnHand } from "./on-hand";
import {
  type EnrichedRecipe,
  enrichRecipes,
  type MealType,
  type PlanResult,
  type PlanWeekOptions,
  planWeek,
} from "./planner";
import { findExcludedTag, parseQuantity, type ScoredIngredient } from "./scoring";
import * as store from "./store";
import { scoreAllRecipes } from "./tools/scoring";

export interface PlanRequest {
  budget: number;
  people?: number;
  days?: number;
  meals?: MealType[];
  kcalPerPersonPerDay?: number;
  /** Individual kcal targets, one per person — overrides kcalPerPersonPerDay
   * (engine targets the mean; result reports per-person portion factors). */
  kcalPerPerson?: number[];
  /** Daily protein target (g/person) — reported against the plan, and the
   * AI planner composes toward it. */
  proteinPerPersonPerDay?: number;
  excludeProteins?: string[];
  maxCookMinutes?: number;
  mealPrep?: boolean;
  cookDays?: number[];
  location?: string;
  radiusKm?: number;
  maxPerProtein?: number;
  maxPerCuisine?: number;
  maxSlowDays?: number;
  /** AI mode: GPT composes the week + audits deal matches; code re-verifies totals. */
  ai?: boolean;
  /** Free-text wishes passed to the AI planner ("mere fisk, ingen supper"). */
  wishes?: string;
  /** What the user already has at home, free text ("500 g hakket oksekød,
   * 6 æg, halv pose spinat"). Opt-in: the week is built around it, it costs
   * 0 kr, and only what's missing lands on the shopping list. */
  onHand?: string;
}

export type PlanServiceOutcome =
  | {
      ok: true;
      result: PlanResult;
      nearby: NearbyStores | null;
      currency: string;
      ai: AiPlanExtras | null;
    }
  | { ok: false; error: string };

/** Expand the "vegetarian" shorthand into concrete exclusion tags. */
function expandExclusions(excludeProteins?: string[]): string[] | undefined {
  if (!excludeProteins?.some((e) => e.toLowerCase() === "vegetarian")) return excludeProteins;
  return [
    ...new Set([
      ...excludeProteins.filter((e) => e.toLowerCase() !== "vegetarian"),
      "pork",
      "beef",
      "lamb",
      "fish",
      "shellfish",
      "chicken",
    ]),
  ];
}

/** Honest note when the hard radius filter shaped the plan. */
function pushRadiusNote(
  notes: string[],
  nearby: NearbyStores | null,
  allowedStores: Set<string> | null,
): void {
  if (!nearby || allowedStores === null) return;
  if (allowedStores.size === 0) {
    notes.push(
      `ingen kæder fundet inden for ${nearby.radiusKm} km — planen bruger kun basisvare-estimater`,
    );
  } else {
    notes.push(
      `kun butikker inden for ${nearby.radiusKm} km er brugt (${[...allowedStores].sort().join(", ")})`,
    );
  }
}

/** Drop on-hand items that break an (absolute) dietary exclusion. */
function onHandWithinDiet(
  items: OnHandItem[],
  opts: PlanWeekOptions,
): { kept: OnHandItem[]; dropped: string[] } {
  const exclusions = opts.constraints.excludeProteins ?? [];
  if (exclusions.length === 0) return { kept: items, dropped: [] };
  const kept: OnHandItem[] = [];
  const dropped: string[] = [];
  for (const item of items) {
    const asIngredient = [{ name: item.name }] as ScoredIngredient[];
    if (findExcludedTag(asIngredient, exclusions, opts.constraints.ingredientTags)) {
      dropped.push(item.name);
    } else {
      kept.push(item);
    }
  }
  return { kept, dropped };
}

/** Scale a library quantity ("400 g" for 4 servings) to one household meal. */
function scaledQuantity(quantity: string, servings: number, people: number): string {
  const parsed = parseQuantity(quantity);
  if (!parsed || servings <= 0) return quantity;
  return `${Math.round(((parsed.amount * people) / servings) * 100) / 100} ${parsed.unit}`;
}

export async function runPlanWeek(req: PlanRequest): Promise<PlanServiceOutcome> {
  const days = req.days ?? 7;
  const meals: MealType[] = req.meals && req.meals.length > 0 ? req.meals : ["dinner"];

  const household = await store.getHousehold();
  const locale = getLocale(household.country);
  const pantry = await store.getPantry();
  const pantrySet = new Set(pantry.map((p) => p.toLowerCase()));
  const preferredStores = new Set(household.stores.map((s) => s.name));
  const householdSize = req.people ?? (household.people.length || household.defaultServings);

  // Location awareness: the radius is a HARD boundary. Chains with a branch
  // inside it become the ONLY chains that may supply deals — a Bilka two
  // hours away must never appear in the plan. (They also get the preferred-
  // store scoring boost.) No location = no filter.
  let nearby: NearbyStores | null = null;
  let allowedStores: Set<string> | null = null;
  if (req.location) {
    nearby = await findStoresNear(req.location, req.radiusKm ?? 3);
    if (nearby) {
      allowedStores = new Set(nearby.nearestByChain.keys());
      for (const brand of nearby.nearestByChain.keys()) {
        preferredStores.add(brand);
      }
    }
  }

  const kcalList = req.kcalPerPerson?.filter((k) => Number.isFinite(k) && k > 0);
  const kcalMean =
    kcalList && kcalList.length > 0
      ? Math.round(kcalList.reduce((a, b) => a + b, 0) / kcalList.length)
      : req.kcalPerPersonPerDay;

  const opts: PlanWeekOptions = {
    budget: req.budget,
    people: householdSize,
    days,
    meals,
    kcalPerPersonPerDay: kcalMean,
    kcalPerPerson: kcalList && kcalList.length > 0 ? kcalList : undefined,
    proteinPerPersonPerDay: req.proteinPerPersonPerDay,
    mealPrep: req.mealPrep,
    cookDays: req.cookDays,
    constraints: {
      maxPerProtein: req.maxPerProtein ?? 2,
      maxPerCuisine: req.maxPerCuisine ?? 2,
      maxSlowDays: req.maxSlowDays ?? 2,
      excludeProteins: expandExclusions(req.excludeProteins),
      ingredientTags: locale.ingredientTags,
    },
  };

  const parsedOnHand = req.onHand ? parseOnHand(req.onHand) : [];
  const { kept: onHand, dropped: onHandDropped } = onHandWithinDiet(parsedOnHand, opts);
  const pushOnHandNotes = (notes: string[]) => {
    if (onHandDropped.length > 0) {
      notes.push(`ikke brugt fra køleskabet (bryder kostvalget): ${onHandDropped.join(", ")}`);
    }
  };

  // AI mode: GPT INVENTS the week's meals from the actual deals — no recipe
  // library involved. The deterministic engine re-prices every invented
  // ingredient, so no number is the model's word alone. Any failure (no key,
  // no credit, bad output) falls back to the library planner with a note.
  let aiExtras: AiPlanExtras | null = null;
  if (req.ai) {
    if (!aiAvailable()) {
      aiExtras = { used: false, error: "OPENAI_API_KEY er ikke sat på serveren" };
    } else {
      const aiOutcome = await aiInventWeek({
        opts,
        wishes: req.wishes,
        pantrySet,
        locale,
        preferredStores,
        maxCookMinutes: req.maxCookMinutes,
        allowedStores,
        onHand,
      });
      if (aiOutcome.ok) {
        pushRadiusNote(aiOutcome.result.notes, nearby, allowedStores);
        pushOnHandNotes(aiOutcome.result.notes);
        return {
          ok: true,
          result: aiOutcome.result,
          nearby,
          currency: locale.currency,
          ai: aiOutcome.extras,
        };
      }
      aiExtras = { used: false, error: aiOutcome.error };
    }
  }

  // Deterministic library path (non-AI mode, and the AI fallback).
  const recipes = await store.getRecipes();
  // On-hand food is free here too: any library ingredient that IS one of the
  // user's items joins the have-set, so recipes using it come out cheaper and
  // the planner leans toward them.
  const haveSet = new Set(pantrySet);
  const onHandByIngredient = new Map<string, OnHandItem>();
  if (onHand.length > 0) {
    for (const recipe of recipes) {
      for (const ing of recipe.ingredients) {
        const item = matchOnHand(ing, onHand);
        if (!item) continue;
        haveSet.add(ing.name.toLowerCase());
        onHandByIngredient.set(ing.name, item);
      }
    }
  }
  const { scored } = await scoreAllRecipes(
    preferredStores,
    haveSet,
    householdSize,
    locale,
    allowedStores,
  );
  let pool: EnrichedRecipe[] = enrichRecipes(scored, recipes, householdSize, haveSet);

  if (req.maxCookMinutes !== undefined) {
    pool = pool.filter((e) => {
      if (req.maxCookMinutes !== undefined && req.maxCookMinutes < 25)
        return e.scored.complexity === "quick";
      if (req.maxCookMinutes !== undefined && req.maxCookMinutes < 45)
        return e.scored.complexity !== "slow";
      return true;
    });
  }

  const result = planWeek(pool, opts);

  if (result === null) {
    return {
      ok: false,
      error: `Not enough eligible recipes for ${days} day(s) × ${meals.length} meal(s) after applying exclusions/time limits. Add more recipes, relax exclusions, or plan fewer days.`,
    };
  }

  pushRadiusNote(result.notes, nearby, allowedStores);
  if (onHand.length > 0) {
    result.onHand = tallyOnHand(
      result.days.flatMap((d) =>
        d.meals.map((m) => ({
          name: m.recipe.scored.name,
          ingredients: m.recipe.recipe.ingredients.map((i) => ({
            name: i.name,
            quantity: scaledQuantity(i.quantity, m.recipe.recipe.servings, householdSize),
          })),
        })),
      ),
      onHand,
      (name) => onHandByIngredient.get(name) ?? null,
    );
    for (const s of result.onHand.short) {
      result.notes.push(`planen bruger ~${s.need} ${s.name}, du har ${s.have} — køb lidt ekstra`);
    }
  }
  pushOnHandNotes(result.notes);
  if (aiExtras?.error) {
    result.notes.push(
      `ai-laget kunne ikke bruges (${aiExtras.error}) — deterministisk plan i stedet`,
    );
  }

  return { ok: true, result, nearby, currency: locale.currency, ai: aiExtras };
}
