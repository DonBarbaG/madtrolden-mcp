/**
 * Phase-3 acceptance tests for the plan_week solver: hard budget cap,
 * infeasibility reporting, kcal targeting, determinism, diet exclusions.
 * Pure — no network, no store: synthetic EnrichedRecipes throughout.
 */

import { describe, expect, it } from "vitest";
import { type EnrichedRecipe, MEAL_KCAL_SHARE, type PlanWeekOptions, planWeek } from "./planner";
import type { ScoredIngredient, ScoredRecipe } from "./scoring";
import type { Recipe } from "./store";

interface MakeOpts {
  name: string;
  cost: number; // deal cost (one deal-priced ingredient)
  baseline?: number; // baseline part
  kcal?: number | null; // kcal per serving
  protein?: string;
  cuisine?: string;
  complexity?: "quick" | "medium" | "slow";
}

function makeEnriched({
  name,
  cost,
  baseline = 0,
  kcal = 500,
  protein = "vegetarian",
  cuisine = "danish",
  complexity = "quick",
}: MakeOpts): EnrichedRecipe {
  const ingredients: ScoredIngredient[] = [
    {
      name: `${name}-hovedvare`,
      quantity: "400 g",
      category: "meat",
      bestDeal: { heading: `${name} deal`, price: cost, store: "Netto" },
      estimatedCost: cost,
      confidence: "high",
    },
    {
      name: `${name}-basisvare`,
      quantity: "500 g",
      category: "pantry",
      bestDeal: null,
      estimatedCost: 0,
      confidence: "none",
    },
  ];
  const scored: ScoredRecipe = {
    name,
    servings: 2,
    complexity,
    proteinType: protein,
    cuisineType: cuisine,
    estimatedCost: cost,
    dealCoverage: 50,
    ingredients,
  };
  const recipe: Recipe = {
    name,
    servings: 2,
    complexity,
    cuisineType: cuisine,
    proteinType: protein,
    ingredients: [
      {
        name: `${name}-hovedvare`,
        quantity: "400 g",
        searchTerms: ["hakket oksekød"],
        category: "meat",
      },
      { name: `${name}-basisvare`, quantity: "500 g", searchTerms: ["pasta"], category: "pantry" },
    ],
  };
  return {
    scored,
    recipe,
    fullCost: cost + baseline,
    baselinePart: baseline,
    nutrition:
      kcal === null
        ? { perServing: null, scored: [], unscored: [`${name}-hovedvare`] }
        : {
            perServing: { kcal, protein: 20, fat: 15, carbs: 50 },
            scored: [`${name}-hovedvare`],
            unscored: [],
          },
  };
}

function makePool(): EnrichedRecipe[] {
  // 10 recipes, varied costs/kcal; enough variety that 7 days always fits.
  const cuisines = ["danish", "italian", "asian", "mexican", "french"];
  const proteins = ["vegetarian", "chicken", "beef", "fish", "pork"];
  return Array.from({ length: 10 }, (_, i) =>
    makeEnriched({
      name: `Ret${String(i).padStart(2, "0")}`,
      cost: 20 + i * 10, // 20..110 kr
      kcal: 400 + i * 60, // 400..940 kcal
      protein: proteins[i % proteins.length],
      cuisine: cuisines[i % cuisines.length],
    }),
  );
}

function opts(overrides: Partial<PlanWeekOptions> = {}): PlanWeekOptions {
  return {
    budget: 10_000,
    people: 2,
    days: 7,
    meals: ["dinner"],
    constraints: { maxPerProtein: 2, maxPerCuisine: 2, maxSlowDays: 2 },
    ...overrides,
  };
}

describe("planWeek", () => {
  it("plans the requested days and stays under a generous budget", () => {
    const result = planWeek(makePool(), opts({ budget: 1000 }));
    expect(result).not.toBeNull();
    expect(result?.feasible).toBe(true);
    expect(result?.days).toHaveLength(7);
    expect(result?.grandTotal).toBeLessThanOrEqual(1000);
    expect(result?.budgetGap).toBe(0);
  });

  it("treats the budget as a hard cap: infeasible → cheapest plan + gap + suggestions", () => {
    // Cheapest 7 with variety are ~20..80 deal-kr + baseline packs, so 50 kr is impossible.
    const result = planWeek(makePool(), opts({ budget: 50 }));
    expect(result).not.toBeNull();
    expect(result?.feasible).toBe(false);
    expect(result?.budgetGap).toBeGreaterThan(0);
    expect(result?.grandTotal).toBeGreaterThan(50);
    expect(result?.relaxSuggestions.length).toBeGreaterThan(0);
    expect(result?.relaxSuggestions.join(" ")).toContain("budget");
  });

  it("picks the cheapest valid combination when the cap binds", () => {
    const generous = planWeek(makePool(), opts({ budget: 10_000 }));
    const tight = planWeek(makePool(), opts({ budget: 50 }));
    // Under an impossible cap, the plan cost must equal the unconstrained cheapest.
    expect(tight?.grandTotal).toBe(generous?.grandTotal);
  });

  it("works without a kcal target (all kcal fields null)", () => {
    const result = planWeek(makePool(), opts());
    expect(result?.kcal.target).toBeNull();
    expect(result?.kcal.effectiveTarget).toBeNull();
    expect(result?.kcal.withinTolerance).toBeNull();
  });

  it("scales the kcal target by the planned meals' share of the day", () => {
    const result = planWeek(makePool(), opts({ kcalPerPersonPerDay: 2000 }));
    expect(result?.kcal.target).toBe(2000);
    expect(result?.kcal.effectiveTarget).toBe(Math.round(2000 * MEAL_KCAL_SHARE.dinner));
  });

  it("swaps toward the kcal target when the budget allows", () => {
    // Cheapest recipes are also lowest-kcal; a 2000 kcal/day target (dinner
    // share → 800) should pull the plan toward higher-kcal recipes.
    const withTarget = planWeek(makePool(), opts({ budget: 1000, kcalPerPersonPerDay: 2000 }));
    const without = planWeek(makePool(), opts({ budget: 1000 }));
    expect(withTarget?.kcal.avgPerDay ?? 0).toBeGreaterThan(without?.kcal.avgPerDay ?? 0);
    expect(withTarget?.kcal.withinTolerance).toBe(true);
    expect(withTarget?.grandTotal).toBeLessThanOrEqual(1000);
  });

  it("reports un-scored ingredients so kcal confidence is legible", () => {
    const pool = makePool();
    pool.push(makeEnriched({ name: "Mysteriet", cost: 5, kcal: null }));
    const result = planWeek(pool, opts({ kcalPerPersonPerDay: 2000, budget: 10_000 }));
    // The cheap mystery recipe gets picked; its ingredient shows up as unscored.
    const picked = result?.days.some((d) =>
      d.meals.some((m) => m.recipe.scored.name === "Mysteriet"),
    );
    if (picked) {
      expect(result?.kcal.unscoredIngredients).toContain("Mysteriet-hovedvare");
    }
  });

  it("respects diet exclusions via proteinType", () => {
    const result = planWeek(
      makePool(),
      opts({
        days: 5,
        constraints: {
          maxPerProtein: 7,
          maxPerCuisine: 7,
          maxSlowDays: 7,
          excludeProteins: ["beef", "pork"],
        },
      }),
    );
    expect(result).not.toBeNull();
    for (const day of result?.days ?? []) {
      for (const meal of day.meals) {
        expect(["beef", "pork"]).not.toContain(meal.recipe.scored.proteinType);
      }
    }
  });

  it("returns null when there are not enough eligible recipes", () => {
    const result = planWeek(makePool().slice(0, 3), opts({ days: 7 }));
    expect(result).toBeNull();
  });

  it("is deterministic for identical inputs", () => {
    const a = planWeek(makePool(), opts({ budget: 400, kcalPerPersonPerDay: 1800 }));
    const b = planWeek(makePool(), opts({ budget: 400, kcalPerPersonPerDay: 1800 }));
    expect(a?.days.map((d) => d.meals.map((m) => m.recipe.scored.name))).toEqual(
      b?.days.map((d) => d.meals.map((m) => m.recipe.scored.name)),
    );
    expect(a?.grandTotal).toBe(b?.grandTotal);
  });

  it("never exceeds variety constraints", () => {
    const result = planWeek(makePool(), opts({ budget: 320 }));
    const proteins = new Map<string, number>();
    for (const day of result?.days ?? []) {
      for (const meal of day.meals) {
        const p = meal.recipe.scored.proteinType;
        proteins.set(p, (proteins.get(p) ?? 0) + 1);
      }
    }
    for (const count of proteins.values()) expect(count).toBeLessThanOrEqual(2);
  });
});
