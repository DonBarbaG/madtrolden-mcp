// plan_week solver: greedy seed + local search under a HARD budget cap and
// an optional kcal target — meal-type aware (breakfast/lunch/dinner pools)
// with an optional meal-prep mode that consolidates cooking into cook days
// and schedules leftovers onto the calendar. Understandable over clever,
// deterministic given the same inputs and cache state.
//
// Cost model per recipe = deal-priced ingredients (whole-pack math from
// scoring.ts, already scaled to household) + baseline estimates for
// everything without a deal (lib/baseline.ts). Plan totals split into
// "deal items: X kr" + "estimated staples: ~Y kr".

import { baselineFractionalCost, estimatePlanBaseline, type PlanBaseline } from "./baseline";
import { computeRecipeNutrition, type RecipeNutrition } from "./nutrition";
import { findExcludedTag, type ScoredRecipe, type VarietyConstraints } from "./scoring";
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

export function mealTypeOf(e: EnrichedRecipe): MealType {
  return e.recipe.mealType ?? "dinner";
}

export interface PlanWeekOptions {
  budget: number;
  people: number;
  days: number;
  meals: MealType[];
  kcalPerPersonPerDay?: number;
  constraints: VarietyConstraints;
  /** Meal-prep mode: consolidate cooking onto cookDays, schedule leftovers. */
  mealPrep?: boolean;
  /** 1-indexed cook days within the plan (default [1, 4]). */
  cookDays?: number[];
}

export interface PlannedMeal {
  mealType: MealType;
  recipe: EnrichedRecipe;
  /** True when this meal is leftovers from an earlier cook day. */
  leftover: boolean;
  /** Which day this meal's batch is cooked (meal-prep mode). */
  cookedOnDay: number;
}

export interface PlanDay {
  day: number;
  meals: PlannedMeal[];
  kcalPerPerson: number | null;
}

export interface CookBlock {
  day: number;
  mealType: MealType;
  recipeName: string;
  /** Total servings to cook (people × days covered). */
  portions: number;
  /** 1-indexed days this batch feeds. */
  covers: number[];
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
  /** Honest caveats: auto-relaxed variety caps, repeated recipes, etc. */
  notes: string[];
  /** Present in meal-prep mode: what to cook when, and what it covers. */
  cookSchedule?: CookBlock[];
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

// --- Variety bookkeeping (applied per meal type) ---

interface VarietyState {
  used: Set<string>;
  protein: Record<string, number>;
  cuisine: Record<string, number>;
  slow: number;
}

function newState(): VarietyState {
  return { used: new Set(), protein: {}, cuisine: {}, slow: 0 };
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

function varietyValidForMeal(plan: EnrichedRecipe[], c: VarietyConstraints): boolean {
  const state = newState();
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

/** Auto-relax variety caps to what a pool's diversity allows (reported). */
function relaxConstraintsFor(
  poolForMeal: EnrichedRecipe[],
  needed: number,
  base: VarietyConstraints,
  mealType: MealType,
  notes: string[],
): VarietyConstraints {
  const distinctProteins = new Set(poolForMeal.map((e) => e.scored.proteinType)).size || 1;
  const distinctCuisines = new Set(poolForMeal.map((e) => e.scored.cuisineType)).size || 1;
  const c = { ...base };
  const needProtein = Math.ceil(needed / distinctProteins);
  const needCuisine = Math.ceil(needed / distinctCuisines);
  if (needProtein > c.maxPerProtein) {
    c.maxPerProtein = needProtein;
    notes.push(
      `${mealType}: variety cap on protein auto-raised to ${needProtein} (only ${distinctProteins} protein type(s) available after exclusions)`,
    );
  }
  if (needCuisine > c.maxPerCuisine) {
    c.maxPerCuisine = needCuisine;
    notes.push(
      `${mealType}: variety cap on cuisine auto-raised to ${needCuisine} (only ${distinctCuisines} cuisine(s) available after exclusions)`,
    );
  }
  return c;
}

// --- Global objective ---

interface SlotAssignment {
  mealType: MealType;
  recipe: EnrichedRecipe;
}

function kcalOfSlots(slots: SlotAssignment[], days: number): number | null {
  const scored = slots.filter((s) => s.recipe.nutrition.perServing !== null);
  if (scored.length === 0) return null;
  const total = scored.reduce((sum, s) => sum + (s.recipe.nutrition.perServing?.kcal ?? 0), 0);
  return Math.round(total / days);
}

/**
 * Register-cost approximation used inside the search loop: every slot pays
 * its recipe's full cost. (The final reported totals use pack-aggregated
 * math; this keeps the search objective simple and monotone.)
 */
function costOfSlots(slots: SlotAssignment[]): number {
  return Math.round(slots.reduce((sum, s) => sum + s.recipe.fullCost, 0) * 100) / 100;
}

function violationOf(
  slots: SlotAssignment[],
  opts: PlanWeekOptions,
  effectiveDailyTarget: number | null,
): number {
  const overBudget = Math.max(0, costOfSlots(slots) - opts.budget);
  let kcalMiss = 0;
  if (effectiveDailyTarget !== null) {
    const avg = kcalOfSlots(slots, opts.days);
    if (avg !== null) {
      const tolerance = effectiveDailyTarget * 0.1;
      kcalMiss = Math.max(0, Math.abs(avg - effectiveDailyTarget) - tolerance);
    }
  }
  return overBudget * 1000 + kcalMiss;
}

function localSearch(
  seed: SlotAssignment[],
  poolByMeal: Map<MealType, EnrichedRecipe[]>,
  constraintsByMeal: Map<MealType, VarietyConstraints>,
  opts: PlanWeekOptions,
  effectiveDailyTarget: number | null,
): SlotAssignment[] {
  let slots = [...seed];
  let bestViolation = violationOf(slots, opts, effectiveDailyTarget);
  let bestCost = costOfSlots(slots);

  const validForMeal = (trial: SlotAssignment[], mealType: MealType): boolean => {
    const plan = trial.filter((s) => s.mealType === mealType).map((s) => s.recipe);
    const c = constraintsByMeal.get(mealType);
    return c ? varietyValidForMeal(plan, c) : true;
  };

  for (let round = 0; round < 25 && bestViolation > 0; round++) {
    let improved = false;
    for (let i = 0; i < slots.length; i++) {
      const mealType = slots[i].mealType;
      for (const candidate of poolByMeal.get(mealType) ?? []) {
        if (
          slots.some(
            (s) => s.mealType === mealType && s.recipe.scored.name === candidate.scored.name,
          )
        ) {
          continue;
        }
        const trial = [...slots];
        trial[i] = { mealType, recipe: candidate };
        if (!validForMeal(trial, mealType)) continue;
        const v = violationOf(trial, opts, effectiveDailyTarget);
        const c = costOfSlots(trial);
        if (v < bestViolation || (v === bestViolation && c < bestCost)) {
          slots = trial;
          bestViolation = v;
          bestCost = c;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return slots;
}

// --- Result assembly (shared by normal and meal-prep modes) ---

function assembleResult(
  days: PlanDay[],
  opts: PlanWeekOptions,
  notes: string[],
  cookSchedule?: CookBlock[],
): PlanResult {
  const allMeals = days.flatMap((d) => d.meals);

  // Deal total: whole-pack per distinct (recipe, ingredient) purchase; a
  // batch cooked once is bought once, a recipe repeated on separate days
  // needs the packs again per extra cook.
  const dealSeen = new Map<string, number>();
  for (const meal of allMeals) {
    const cookKey = `${meal.recipe.scored.name}|${meal.cookedOnDay}`;
    if (!dealSeen.has(cookKey)) {
      const dealCost = meal.recipe.scored.ingredients.reduce(
        (sum, i) => sum + (i.bestDeal ? i.bestDeal.price : 0),
        0,
      );
      dealSeen.set(cookKey, dealCost);
    }
  }
  // In meal-prep mode a batch covers several days, so scale its cost by the
  // days covered (portions scale linearly with servings).
  let dealTotal = 0;
  const baselineNeeds: Array<{
    ingredient: Recipe["ingredients"][number];
    recipeServings: number;
  }> = [];
  const countedCooks = new Set<string>();
  for (const meal of allMeals) {
    const cookKey = `${meal.recipe.scored.name}|${meal.cookedOnDay}`;
    const coverCount = allMeals.filter(
      (m) => `${m.recipe.scored.name}|${m.cookedOnDay}` === cookKey,
    ).length;
    if (countedCooks.has(cookKey)) continue;
    countedCooks.add(cookKey);
    dealTotal += (dealSeen.get(cookKey) ?? 0) * coverCount;
    for (const ing of meal.recipe.scored.ingredients) {
      if (ing.bestDeal !== null) continue;
      const src = meal.recipe.recipe.ingredients.find((ri) => ri.name === ing.name);
      if (!src) continue;
      for (let i = 0; i < coverCount; i++) {
        baselineNeeds.push({ ingredient: src, recipeServings: meal.recipe.recipe.servings });
      }
    }
  }
  dealTotal = Math.round(dealTotal);

  const baseline = estimatePlanBaseline(baselineNeeds, opts.people);
  const grandTotal = dealTotal + baseline.total;
  const budgetGap = Math.max(0, Math.round((grandTotal - opts.budget) * 100) / 100);

  const mealShare = opts.meals.reduce((sum, m) => sum + (MEAL_KCAL_SHARE[m] ?? 0), 0);
  const effectiveDailyTarget = opts.kcalPerPersonPerDay
    ? Math.round(opts.kcalPerPersonPerDay * mealShare)
    : null;
  const slotList: SlotAssignment[] = allMeals.map((m) => ({
    mealType: m.mealType,
    recipe: m.recipe,
  }));
  const avgKcal = kcalOfSlots(slotList, opts.days);
  const withinTolerance =
    effectiveDailyTarget !== null && avgKcal !== null
      ? Math.abs(avgKcal - effectiveDailyTarget) <= effectiveDailyTarget * 0.1
      : null;
  const unscored = [...new Set(allMeals.flatMap((m) => m.recipe.nutrition.unscored))].sort();

  const relaxSuggestions: string[] = [];
  if (budgetGap > 0) {
    relaxSuggestions.push(`increase the budget by ~${Math.ceil(budgetGap)} kr`);
    if (opts.days > 3) relaxSuggestions.push("plan fewer days");
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
    notes,
    cookSchedule,
  };
}

// --- Normal mode ---

function planNormal(
  poolByMeal: Map<MealType, EnrichedRecipe[]>,
  opts: PlanWeekOptions,
  notes: string[],
): PlanDay[] | null {
  const constraintsByMeal = new Map<MealType, VarietyConstraints>();
  const perMealPicks = new Map<MealType, EnrichedRecipe[]>();

  for (const mealType of opts.meals) {
    const pool = poolByMeal.get(mealType) ?? [];
    if (pool.length === 0) return null;
    const constraints = relaxConstraintsFor(pool, opts.days, opts.constraints, mealType, notes);
    constraintsByMeal.set(mealType, constraints);

    if (pool.length < opts.days) {
      // Cycle recipes (cheapest first) — a repeated meal beats not planning.
      perMealPicks.set(
        mealType,
        Array.from({ length: opts.days }, (_, i) => pool[i % pool.length]),
      );
      notes.push(
        `${mealType}: only ${pool.length} eligible recipe(s) for ${opts.days} day(s) — some repeat; add more recipes (add_recipe) for variety`,
      );
      continue;
    }
    const state = newState();
    const picks: EnrichedRecipe[] = [];
    for (const e of pool) {
      if (picks.length >= opts.days) break;
      if (!fits(e, state, constraints)) continue;
      picks.push(e);
      record(e, state);
    }
    if (picks.length < opts.days) return null;
    perMealPicks.set(mealType, picks);
  }

  // Interleave into day-major slot order, then improve globally.
  const seed: SlotAssignment[] = [];
  for (let d = 0; d < opts.days; d++) {
    for (const mealType of opts.meals) {
      const picks = perMealPicks.get(mealType);
      if (!picks) return null;
      seed.push({ mealType, recipe: picks[d] });
    }
  }

  const hasRepeats = opts.meals.some((m) => {
    const picks = perMealPicks.get(m) ?? [];
    return new Set(picks.map((e) => e.scored.name)).size < picks.length;
  });

  const mealShare = opts.meals.reduce((sum, m) => sum + (MEAL_KCAL_SHARE[m] ?? 0), 0);
  const effectiveDailyTarget = opts.kcalPerPersonPerDay
    ? Math.round(opts.kcalPerPersonPerDay * mealShare)
    : null;

  const slots = hasRepeats
    ? seed
    : localSearch(seed, poolByMeal, constraintsByMeal, opts, effectiveDailyTarget);

  const days: PlanDay[] = [];
  for (let d = 0; d < opts.days; d++) {
    const meals: PlannedMeal[] = opts.meals.map((mealType, m) => ({
      mealType,
      recipe: slots[d * opts.meals.length + m].recipe,
      leftover: false,
      cookedOnDay: d + 1,
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
  return days;
}

// --- Meal-prep mode ---

interface PrepBlock {
  mealType: MealType;
  recipe: EnrichedRecipe;
  cookDay: number;
  covers: number[];
}

function keepsDaysOf(e: EnrichedRecipe): number {
  return e.recipe.keepsDays ?? 0;
}

/**
 * Split the week into segments starting at each cook day, then fill each
 * segment per meal type with batchable recipes. A recipe whose leftovers
 * don't keep long enough forces an extra cook event (reported).
 */
function planPrep(
  poolByMeal: Map<MealType, EnrichedRecipe[]>,
  opts: PlanWeekOptions,
  notes: string[],
): { days: PlanDay[]; cookSchedule: CookBlock[] } | null {
  const cookDays = [...new Set(opts.cookDays ?? [1, 4])]
    .filter((d) => d >= 1 && d <= opts.days)
    .sort((a, b) => a - b);
  if (cookDays.length === 0 || cookDays[0] !== 1) {
    // The plan must start with a cook day — day 1 has nothing to leftover from.
    cookDays.unshift(1);
  }

  const segments: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < cookDays.length; i++) {
    const start = cookDays[i];
    const end = i + 1 < cookDays.length ? cookDays[i + 1] - 1 : opts.days;
    if (end >= start) segments.push({ start, end });
  }

  const blocks: PrepBlock[] = [];
  let extraCooks = 0;

  for (const mealType of opts.meals) {
    const pool = poolByMeal.get(mealType) ?? [];
    if (pool.length === 0) return null;
    // Prefer batchable recipes; fall back to the full pool with a note.
    let prepPool = pool.filter((e) => e.recipe.batchable === true);
    if (prepPool.length === 0) {
      prepPool = pool;
      notes.push(
        `${mealType}: no batchable recipes available — meal-prep quality will be limited (recipes cooked fresh)`,
      );
    }
    const used = new Set<string>();
    const nextRecipe = (remainingDays: number): EnrichedRecipe => {
      // Prefer (cheapest) unused recipe whose leftovers span the remaining
      // segment; otherwise the unused recipe that keeps longest; otherwise cycle.
      const unused = prepPool.filter((e) => !used.has(e.scored.name));
      const spanning = unused.filter((e) => keepsDaysOf(e) + 1 >= remainingDays);
      const longestKeeper = [...unused].sort(
        (a, b) => keepsDaysOf(b) - keepsDaysOf(a) || a.fullCost - b.fullCost,
      )[0];
      const pick = spanning[0] ?? longestKeeper ?? prepPool[used.size % prepPool.length];
      used.add(pick.scored.name);
      return pick;
    };

    for (const segment of segments) {
      let day = segment.start;
      while (day <= segment.end) {
        const recipe = nextRecipe(segment.end - day + 1);
        const maxCover = Math.max(1, keepsDaysOf(recipe) + 1);
        const end = Math.min(segment.end, day + maxCover - 1);
        const covers = Array.from({ length: end - day + 1 }, (_, i) => day + i);
        if (day !== segment.start) extraCooks++;
        blocks.push({ mealType, recipe, cookDay: day, covers });
        day = end + 1;
      }
    }
  }

  if (extraCooks > 0) {
    notes.push(
      `${extraCooks} extra cook event(s) beyond the chosen cook days — some recipes' leftovers don't keep long enough (keepsDays); pick longer-keeping recipes to consolidate further`,
    );
  }

  // Budget improvement pass: swap expensive blocks for cheaper batchable ones.
  const mealShare = opts.meals.reduce((sum, m) => sum + (MEAL_KCAL_SHARE[m] ?? 0), 0);
  const effectiveDailyTarget = opts.kcalPerPersonPerDay
    ? Math.round(opts.kcalPerPersonPerDay * mealShare)
    : null;
  const blockViolation = (bs: PrepBlock[]): number => {
    const slots: SlotAssignment[] = bs.flatMap((b) =>
      b.covers.map(() => ({ mealType: b.mealType, recipe: b.recipe })),
    );
    return violationOf(slots, opts, effectiveDailyTarget);
  };
  let currentViolation = blockViolation(blocks);
  for (let round = 0; round < 10 && currentViolation > 0; round++) {
    let improved = false;
    for (const block of blocks) {
      const pool = (poolByMeal.get(block.mealType) ?? []).filter(
        (e) => e.recipe.batchable === true && keepsDaysOf(e) + 1 >= block.covers.length,
      );
      for (const candidate of pool) {
        if (candidate.scored.name === block.recipe.scored.name) continue;
        const original = block.recipe;
        block.recipe = candidate;
        const v = blockViolation(blocks);
        if (v < currentViolation) {
          currentViolation = v;
          improved = true;
        } else {
          block.recipe = original;
        }
      }
    }
    if (!improved) break;
  }

  // Expand blocks into the day calendar.
  const days: PlanDay[] = [];
  for (let d = 1; d <= opts.days; d++) {
    const meals: PlannedMeal[] = [];
    for (const mealType of opts.meals) {
      const block = blocks.find((b) => b.mealType === mealType && b.covers.includes(d));
      if (!block) return null; // every slot must be covered
      meals.push({
        mealType,
        recipe: block.recipe,
        leftover: d !== block.cookDay,
        cookedOnDay: block.cookDay,
      });
    }
    const kcals = meals
      .map((m) => m.recipe.nutrition.perServing?.kcal ?? null)
      .filter((k): k is number => k !== null);
    days.push({
      day: d,
      meals,
      kcalPerPerson: kcals.length > 0 ? kcals.reduce((a, b) => a + b, 0) : null,
    });
  }

  const cookSchedule: CookBlock[] = blocks
    .sort((a, b) => a.cookDay - b.cookDay || a.mealType.localeCompare(b.mealType))
    .map((b) => ({
      day: b.cookDay,
      mealType: b.mealType,
      recipeName: b.recipe.scored.name,
      portions: opts.people * b.covers.length,
      covers: b.covers,
    }));

  return { days, cookSchedule };
}

// --- Entry point ---

export function planWeek(pool: EnrichedRecipe[], opts: PlanWeekOptions): PlanResult | null {
  const notes: string[] = [];
  const eligible = applyDietExclusions(
    // Stable order: cheapest first, name tiebreak → deterministic.
    [...pool].sort((a, b) => a.fullCost - b.fullCost || a.scored.name.localeCompare(b.scored.name)),
    opts.constraints,
  );
  if (eligible.length === 0) return null;

  const poolByMeal = new Map<MealType, EnrichedRecipe[]>();
  for (const mealType of opts.meals) {
    poolByMeal.set(
      mealType,
      eligible.filter((e) => mealTypeOf(e) === mealType),
    );
  }

  if (opts.mealPrep) {
    const prep = planPrep(poolByMeal, opts, notes);
    if (!prep) return null;
    return assembleResult(prep.days, opts, notes, prep.cookSchedule);
  }

  const days = planNormal(poolByMeal, opts, notes);
  if (!days) return null;
  return assembleResult(days, opts, notes);
}
