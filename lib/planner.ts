// plan_week solver: greedy seed + local search under a HARD budget cap and
// an optional kcal target. Understandable over clever, deterministic given
// the same inputs and cache state (stable sorts, no randomness).
//
// Cost model per recipe = deal-priced ingredients (whole-pack math from
// scoring.ts, already scaled to household) + baseline estimates for
// everything without a deal (lib/baseline.ts). Plan totals split into
// "deal items: X kr" + "estimated staples: ~Y kr".

import { baselineFractionalCost, estimatePlanBaseline, type PlanBaseline } from "./baseline";
import { computeRecipeNutrition, type RecipeNutrition } from "./nutrition";
import {
  calculateBasketCost,
  findExcludedTag,
  type ScoredRecipe,
  type VarietyConstraints,
} from "./scoring";
import type { Recipe } from "./store";

// Share of a day's kcal each meal type is expected to cover. When only a
// subset of meals is planned, the kcal target scales by the planned share so
// "2000 kcal, dinners only" means dinners around 800 kcal — the output
// states this explicitly.
export const MEAL_KCAL_SHARE: Record<string, number> = {
  breakfast: 0.25,
  lunch: 0.35,
  dinner: 0.4,
};

export type MealType = "breakfast" | "lunch" | "dinner";

export interface EnrichedRecipe {
  scored: ScoredRecipe;
  recipe: Recipe;
  /** Deal cost (household-scaled) + fractional baseline for no-deal items. */
  fullCost: number;
  /** Baseline share of fullCost (for reporting). */
  baselinePart: number;
  nutrition: RecipeNutrition;
}

export interface PlanWeekOptions {
  budget: number;
  people: number;
  days: number;
  meals: MealType[];
  kcalPerPersonPerDay?: number;
  constraints: VarietyConstraints;
}

export interface PlanDay {
  day: number;
  meals: Array<{ mealType: MealType; recipe: EnrichedRecipe }>;
  kcalPerPerson: number | null;
}

export interface PlanResult {
  feasible: boolean;
  days: PlanDay[];
  dealTotal: number;
  baseline: PlanBaseline;
  grandTotal: number;
  budget: number;
  budgetGap: number; // > 0 when over budget (infeasible)
  kcal: {
    target: number | null;
    effectiveTarget: number | null; // scaled by planned-meal share
    avgPerDay: number | null;
    withinTolerance: boolean | null;
    unscoredIngredients: string[];
  };
  relaxSuggestions: string[];
}

/** Enrich scored recipes with baseline costs and nutrition. */
export function enrichRecipes(
  scored: ScoredRecipe[],
  recipes: Recipe[],
  householdSize: number,
  pantrySet: Set<string>,
): EnrichedRecipe[] {
  const byName = new Map(recipes.map((r) => [r.name, r]));
  const out: EnrichedRecipe[] = [];
  for (const s of scored) {
    const recipe = byName.get(s.name);
    if (!recipe) continue;
    let baselinePart = 0;
    for (const ing of s.ingredients) {
      if (ing.bestDeal !== null) continue; // deal wins over estimate
      const src = recipe.ingredients.find((ri) => ri.name === ing.name);
      if (!src || pantrySet.has(src.name.toLowerCase())) continue;
      const est = baselineFractionalCost(src, recipe.servings, householdSize);
      if (est) baselinePart += est.cost;
    }
    baselinePart = Math.round(baselinePart * 100) / 100;
    out.push({
      scored: s,
      recipe,
      fullCost: Math.round((s.estimatedCost + baselinePart) * 100) / 100,
      baselinePart,
      nutrition: computeRecipeNutrition(recipe),
    });
  }
  return out;
}

interface VarietyState {
  used: Set<string>;
  protein: Record<string, number>;
  cuisine: Record<string, number>;
  slow: number;
}

function fits(e: EnrichedRecipe, state: VarietyState, c: VarietyConstraints): boolean {
  const r = e.scored;
  if (state.used.has(r.name)) return false;
  if ((state.protein[r.proteinType] ?? 0) >= c.maxPerProtein) return false;
  if ((state.cuisine[r.cuisineType] ?? 0) >= c.maxPerCuisine) return false;
  if (r.complexity === "slow" && state.slow >= c.maxSlowDays) return false;
  return true;
}

function record(e: EnrichedRecipe, state: VarietyState): void {
  const r = e.scored;
  state.used.add(r.name);
  state.protein[r.proteinType] = (state.protein[r.proteinType] ?? 0) + 1;
  state.cuisine[r.cuisineType] = (state.cuisine[r.cuisineType] ?? 0) + 1;
  if (r.complexity === "slow") state.slow += 1;
}

function varietyValid(plan: EnrichedRecipe[], c: VarietyConstraints): boolean {
  const state: VarietyState = { used: new Set(), protein: {}, cuisine: {}, slow: 0 };
  for (const e of plan) {
    if (!fits(e, state, c)) return false;
    record(e, state);
  }
  return true;
}

function applyDietExclusions(
  pool: EnrichedRecipe[],
  constraints: VarietyConstraints,
): EnrichedRecipe[] {
  const exclusions = constraints.excludeProteins ?? [];
  if (exclusions.length === 0) return pool;
  return pool.filter((e) => {
    if (exclusions.includes(e.scored.proteinType)) return false;
    return !findExcludedTag(e.scored.ingredients, exclusions, constraints.ingredientTags);
  });
}

function kcalOfPlan(plan: EnrichedRecipe[], days: number): number | null {
  const scored = plan.filter((e) => e.nutrition.perServing !== null);
  if (scored.length === 0) return null;
  const total = scored.reduce((sum, e) => sum + (e.nutrition.perServing?.kcal ?? 0), 0);
  // Average across days; each person eats one serving per planned meal.
  return Math.round(total / days);
}

function planCost(plan: EnrichedRecipe[]): number {
  const dealPart = calculateBasketCost(plan.map((e) => e.scored)).totalCost;
  const baselinePart = plan.reduce((sum, e) => sum + e.baselinePart, 0);
  return Math.round((dealPart + baselinePart) * 100) / 100;
}

/** Violation score for local search: budget overrun dominates, then kcal miss. */
function violation(
  plan: EnrichedRecipe[],
  opts: PlanWeekOptions,
  effectiveDailyTarget: number | null,
): number {
  const cost = planCost(plan);
  const overBudget = Math.max(0, cost - opts.budget);
  let kcalMiss = 0;
  if (effectiveDailyTarget !== null) {
    const avg = kcalOfPlan(plan, opts.days);
    if (avg !== null) {
      const tolerance = effectiveDailyTarget * 0.1;
      kcalMiss = Math.max(0, Math.abs(avg - effectiveDailyTarget) - tolerance);
    }
  }
  return overBudget * 1000 + kcalMiss;
}

function localSearch(
  seed: EnrichedRecipe[],
  pool: EnrichedRecipe[],
  opts: PlanWeekOptions,
  effectiveDailyTarget: number | null,
): EnrichedRecipe[] {
  let plan = [...seed];
  let bestViolation = violation(plan, opts, effectiveDailyTarget);
  let bestCost = planCost(plan);

  for (let round = 0; round < 25 && bestViolation > 0; round++) {
    let improved = false;
    for (let slot = 0; slot < plan.length; slot++) {
      for (const candidate of pool) {
        if (plan.some((e) => e.scored.name === candidate.scored.name)) continue;
        const trial = [...plan];
        trial[slot] = candidate;
        if (!varietyValid(trial, opts.constraints)) continue;
        const v = violation(trial, opts, effectiveDailyTarget);
        const c = planCost(trial);
        if (v < bestViolation || (v === bestViolation && c < bestCost)) {
          plan = trial;
          bestViolation = v;
          bestCost = c;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return plan;
}

export function planWeek(pool: EnrichedRecipe[], opts: PlanWeekOptions): PlanResult | null {
  const slots = opts.days * opts.meals.length;
  const eligible = applyDietExclusions(
    // Stable order: cheapest first, name tiebreak → deterministic.
    [...pool].sort((a, b) => a.fullCost - b.fullCost || a.scored.name.localeCompare(b.scored.name)),
    opts.constraints,
  );
  if (eligible.length < slots) return null;

  const mealShare = opts.meals.reduce((sum, m) => sum + (MEAL_KCAL_SHARE[m] ?? 0), 0);
  const effectiveDailyTarget = opts.kcalPerPersonPerDay
    ? Math.round(opts.kcalPerPersonPerDay * mealShare)
    : null;

  // Greedy seed: cheapest recipes that keep variety valid.
  const state: VarietyState = { used: new Set(), protein: {}, cuisine: {}, slow: 0 };
  const seed: EnrichedRecipe[] = [];
  for (const e of eligible) {
    if (seed.length >= slots) break;
    if (!fits(e, state, opts.constraints)) continue;
    seed.push(e);
    record(e, state);
  }
  if (seed.length < slots) return null;

  const plan = localSearch(seed, eligible, opts, effectiveDailyTarget);

  // Assemble result
  const days: PlanDay[] = [];
  for (let d = 0; d < opts.days; d++) {
    const meals = opts.meals.map((mealType, m) => ({
      mealType,
      recipe: plan[d * opts.meals.length + m],
    }));
    const kcals = meals
      .map((m) => m.recipe.nutrition.perServing?.kcal ?? null)
      .filter((k): k is number => k !== null);
    days.push({
      day: d + 1,
      meals,
      kcalPerPerson: kcals.length > 0 ? kcals.reduce((a, b) => a + b, 0) : null,
    });
  }

  const dealTotal = Math.round(calculateBasketCost(plan.map((e) => e.scored)).totalCost);
  const baseline = estimatePlanBaseline(
    plan.flatMap((e) =>
      e.scored.ingredients
        .filter((i) => i.bestDeal === null)
        .map((i) => {
          const src = e.recipe.ingredients.find((ri) => ri.name === i.name);
          return src ? { ingredient: src, recipeServings: e.recipe.servings } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    ),
    opts.people,
  );
  const grandTotal = dealTotal + baseline.total;
  const budgetGap = Math.max(0, Math.round((grandTotal - opts.budget) * 100) / 100);

  const avgKcal = kcalOfPlan(plan, opts.days);
  const withinTolerance =
    effectiveDailyTarget !== null && avgKcal !== null
      ? Math.abs(avgKcal - effectiveDailyTarget) <= effectiveDailyTarget * 0.1
      : null;
  const unscored = [...new Set(plan.flatMap((e) => e.nutrition.unscored))].sort();

  const relaxSuggestions: string[] = [];
  if (budgetGap > 0) {
    relaxSuggestions.push(`increase the budget by ~${Math.ceil(budgetGap)} kr`);
    if (opts.days > 3) relaxSuggestions.push("plan fewer days");
    if (opts.constraints.maxPerProtein < opts.days)
      relaxSuggestions.push("allow more repetition (raise maxPerProtein/maxPerCuisine)");
    relaxSuggestions.push("add cheaper recipes (lentils, eggs, cabbage, oats)");
  }
  if (withinTolerance === false && effectiveDailyTarget !== null && avgKcal !== null) {
    relaxSuggestions.push(
      avgKcal < effectiveDailyTarget
        ? "add higher-energy recipes or plan more meals per day to reach the kcal target"
        : "choose lighter recipes or reduce portions to meet the kcal target",
    );
  }

  return {
    feasible: budgetGap === 0,
    days,
    dealTotal,
    baseline,
    grandTotal,
    budget: opts.budget,
    budgetGap,
    kcal: {
      target: opts.kcalPerPersonPerDay ?? null,
      effectiveTarget: effectiveDailyTarget,
      avgPerDay: avgKcal,
      withinTolerance,
      unscoredIngredients: unscored,
    },
    relaxSuggestions,
  };
}
