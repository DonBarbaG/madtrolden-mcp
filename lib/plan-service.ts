// Shared plan_week pipeline — used by both the MCP tool (lib/tools/planner.ts)
// and the private web UI's JSON endpoint (app/api/plan/route.ts), so the two
// surfaces can never drift apart.

import { getLocale } from "./locales";
import { findStoresNear, type NearbyStores } from "./location";
import {
  type EnrichedRecipe,
  enrichRecipes,
  type MealType,
  type PlanResult,
  planWeek,
} from "./planner";
import * as store from "./store";
import { scoreAllRecipes } from "./tools/scoring";

export interface PlanRequest {
  budget: number;
  people?: number;
  days?: number;
  meals?: MealType[];
  kcalPerPersonPerDay?: number;
  excludeProteins?: string[];
  maxCookMinutes?: number;
  mealPrep?: boolean;
  cookDays?: number[];
  location?: string;
  radiusKm?: number;
  maxPerProtein?: number;
  maxPerCuisine?: number;
  maxSlowDays?: number;
}

export type PlanServiceOutcome =
  | { ok: true; result: PlanResult; nearby: NearbyStores | null; currency: string }
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

export async function runPlanWeek(req: PlanRequest): Promise<PlanServiceOutcome> {
  const days = req.days ?? 7;
  const meals: MealType[] = req.meals && req.meals.length > 0 ? req.meals : ["dinner"];

  const household = await store.getHousehold();
  const locale = getLocale(household.country);
  const pantry = await store.getPantry();
  const pantrySet = new Set(pantry.map((p) => p.toLowerCase()));
  const preferredStores = new Set(household.stores.map((s) => s.name));
  const householdSize = req.people ?? (household.people.length || household.defaultServings);

  // Location awareness: chains with a branch inside the radius get the same
  // scoring boost as preferred stores.
  let nearby: NearbyStores | null = null;
  if (req.location) {
    nearby = await findStoresNear(req.location, req.radiusKm ?? 3);
    if (nearby) {
      for (const brand of nearby.nearestByChain.keys()) {
        preferredStores.add(brand);
      }
    }
  }

  const recipes = await store.getRecipes();
  const { scored } = await scoreAllRecipes(preferredStores, pantrySet, householdSize, locale);
  let pool: EnrichedRecipe[] = enrichRecipes(scored, recipes, householdSize, pantrySet);

  if (req.maxCookMinutes !== undefined) {
    pool = pool.filter((e) => {
      if (req.maxCookMinutes !== undefined && req.maxCookMinutes < 25)
        return e.scored.complexity === "quick";
      if (req.maxCookMinutes !== undefined && req.maxCookMinutes < 45)
        return e.scored.complexity !== "slow";
      return true;
    });
  }

  const result = planWeek(pool, {
    budget: req.budget,
    people: householdSize,
    days,
    meals,
    kcalPerPersonPerDay: req.kcalPerPersonPerDay,
    mealPrep: req.mealPrep,
    cookDays: req.cookDays,
    constraints: {
      maxPerProtein: req.maxPerProtein ?? 2,
      maxPerCuisine: req.maxPerCuisine ?? 2,
      maxSlowDays: req.maxSlowDays ?? 2,
      excludeProteins: expandExclusions(req.excludeProteins),
      ingredientTags: locale.ingredientTags,
    },
  });

  if (result === null) {
    return {
      ok: false,
      error: `Not enough eligible recipes for ${days} day(s) × ${meals.length} meal(s) after applying exclusions/time limits. Add more recipes, relax exclusions, or plan fewer days.`,
    };
  }

  return { ok: true, result, nearby, currency: locale.currency };
}
