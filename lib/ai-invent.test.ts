/**
 * Unit tests for lib/ai-invent.ts — the AI-invented week planner's pure
 * parts: response normalization, maybe-classification, recipe building,
 * catalog filtering, and the hard-cap trim pass. The GPT call itself is not
 * exercised here (askJson is network); everything the engine does with the
 * model's output is.
 */

import { describe, expect, it } from "vitest";
import {
  buildDealCatalog,
  buildInventedRecipes,
  buildMaybeBucket,
  isMaybeIngredient,
  normalizeInventResponse,
  trimToBudget,
} from "./ai-invent";
import type { Offer } from "./api";
import {
  assembleResult,
  type EnrichedRecipe,
  type MealType,
  type PlanWeekOptions,
} from "./planner";

function opts(partial: Partial<PlanWeekOptions> = {}): PlanWeekOptions {
  return {
    budget: 300,
    people: 1,
    days: 2,
    meals: ["dinner"] as MealType[],
    constraints: { maxPerProtein: 2, maxPerCuisine: 2, maxSlowDays: 2 },
    ...partial,
  };
}

function meal(
  mealType: string,
  name: string,
  ingredients: unknown[] = [{ name: "ris", quantity: "100 g" }],
) {
  return { mealType, name, ingredients };
}

describe("normalizeInventResponse", () => {
  it("accepts a well-formed week and normalizes meals per requested type", () => {
    const res = normalizeInventResponse(
      {
        days: [
          { day: 1, meals: [meal("dinner", "linsegryde")] },
          { day: 2, meals: [meal("dinner", "kålsuppe")] },
        ],
      },
      opts(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.days).toHaveLength(2);
      expect(res.days[0][0].name).toBe("linsegryde");
    }
  });

  it("rejects a missing meal type on any day", () => {
    const res = normalizeInventResponse(
      {
        days: [
          { day: 1, meals: [meal("dinner", "linsegryde")] },
          { day: 2, meals: [meal("lunch", "salat")] },
        ],
      },
      opts(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("dag 2");
  });

  it("rejects the wrong day count", () => {
    const res = normalizeInventResponse(
      { days: [{ day: 1, meals: [meal("dinner", "x")] }] },
      opts(),
    );
    expect(res.ok).toBe(false);
  });

  it("resolves leftoverOf to the earlier cook and copies its name", () => {
    const res = normalizeInventResponse(
      {
        days: [
          { day: 1, meals: [meal("dinner", "linsegryde")] },
          { day: 2, meals: [{ mealType: "dinner", name: "rester", leftoverOf: 1 }] },
        ],
      },
      opts(),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.days[1][0].name).toBe("linsegryde");
      expect(res.days[1][0].leftoverOf).toBe(1);
    }
  });

  it("rejects leftoverOf pointing at a later or leftover day", () => {
    const forward = normalizeInventResponse(
      {
        days: [
          { day: 1, meals: [{ mealType: "dinner", name: "rester", leftoverOf: 2 }] },
          { day: 2, meals: [meal("dinner", "linsegryde")] },
        ],
      },
      opts(),
    );
    expect(forward.ok).toBe(false);
  });

  it("rejects a fresh meal without ingredients", () => {
    const res = normalizeInventResponse(
      {
        days: [
          { day: 1, meals: [meal("dinner", "luftmad", [])] },
          { day: 2, meals: [meal("dinner", "kålsuppe")] },
        ],
      },
      opts(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("luftmad");
  });
});

describe("isMaybeIngredient", () => {
  it("flags explicit maybe, condiment categories, and seasoning words", () => {
    expect(isMaybeIngredient({ name: "sojasauce", maybe: true })).toBe(true);
    expect(isMaybeIngredient({ name: "karrypasta", category: "condiment" })).toBe(true);
    expect(isMaybeIngredient({ name: "olivenolie" })).toBe(true);
    expect(isMaybeIngredient({ name: "paprika" })).toBe(true);
  });

  it("leaves real food alone", () => {
    expect(isMaybeIngredient({ name: "kylling", category: "meat" })).toBe(false);
    expect(isMaybeIngredient({ name: "ris", category: "pantry" })).toBe(false);
    expect(isMaybeIngredient({ name: "gulerødder" })).toBe(false);
  });
});

describe("buildInventedRecipes", () => {
  it("splits maybe-items out and keeps quantities/servings household-scaled", () => {
    const normalized = normalizeInventResponse(
      {
        days: [
          {
            day: 1,
            meals: [
              meal("dinner", "kylling og ris", [
                { name: "kylling", quantity: "300 g", searchTerms: ["kylling"], category: "meat" },
                { name: "ris", quantity: "100 g", category: "pantry" },
                { name: "sojasauce", quantity: "20 ml", maybe: true },
              ]),
            ],
          },
          { day: 2, meals: [{ mealType: "dinner", name: "rester", leftoverOf: 1 }] },
        ],
      },
      opts({ people: 2 }),
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const { recipes, maybeItems } = buildInventedRecipes(normalized.days, 2);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].servings).toBe(2);
    expect(recipes[0].ingredients.map((i) => i.name)).toEqual(["kylling", "ris"]);
    expect(recipes[0].mealType).toBe("dinner");
    expect(maybeItems.map((m) => m.name)).toEqual(["sojasauce"]);
  });
});

describe("buildMaybeBucket", () => {
  it("dedupes, skips pantry items, and estimates from baseline prices", () => {
    const bucket = buildMaybeBucket(
      [
        { name: "olivenolie", searchTerms: ["olivenolie"] },
        { name: "olivenolie", searchTerms: ["olivenolie"] },
        { name: "sojasauce", searchTerms: ["sojasauce"] },
      ],
      new Set(["sojasauce"]),
    );
    expect(bucket.lines).toHaveLength(1);
    expect(bucket.lines[0].name).toBe("olivenolie");
    // Estimate comes from baseline data when a match exists; total is the sum
    // of known estimates either way.
    expect(bucket.total).toBe(Math.round(bucket.lines[0].estimate ?? 0));
  });
});

describe("buildDealCatalog", () => {
  function offer(partial: Partial<Offer>): Offer {
    return {
      id: partial.id ?? "o1",
      heading: partial.heading ?? "Kyllingebryst",
      description: null,
      price: partial.price ?? 25,
      prePrice: null,
      currency: "DKK",
      quantity: null,
      unit: null,
      pricePerUnit: null,
      store: partial.store ?? "REMA 1000",
      storeId: "s1",
      validFrom: "",
      validUntil: "",
      imageUrl: null,
      ...partial,
    };
  }

  it("dedupes by id, drops non-food and priceless offers, sorts cheap first", () => {
    const map = new Map<string, Offer[]>([
      ["kylling", [offer({ id: "a", price: 30 }), offer({ id: "a", price: 30 })]],
      ["shampoo", [offer({ id: "b", heading: "Mild shampoo", price: 10 })]],
      [
        "ris",
        [offer({ id: "c", heading: "Løse ris", price: 12 }), offer({ id: "d", price: null })],
      ],
    ]);
    const catalog = buildDealCatalog(map);
    expect(catalog.map((c) => c.heading)).toEqual(["Løse ris", "Kyllingebryst"]);
  });
});

describe("trimToBudget", () => {
  // Two invented dinners: an expensive one and a cheap one. The trim pass
  // must swap expensive slots to the cheap meal until the cap holds.
  function enriched(name: string, cost: number): EnrichedRecipe {
    return {
      scored: {
        name,
        servings: 1,
        complexity: "medium",
        proteinType: "mixed",
        cuisineType: "ai",
        estimatedCost: cost,
        dealCoverage: 100,
        ingredients: [
          {
            name: "vare",
            quantity: "100 g",
            category: "other",
            bestDeal: { heading: "vare", price: cost, store: "REMA 1000" },
            estimatedCost: cost,
            confidence: "high",
          },
        ],
      },
      recipe: {
        name,
        ingredients: [
          { name: "vare", quantity: "100 g", searchTerms: ["vare"], category: "other" },
        ],
        servings: 1,
        complexity: "medium",
        cuisineType: "ai",
        proteinType: "mixed",
        mealType: "dinner",
      },
      fullCost: cost,
      baselinePart: 0,
      nutrition: { perServing: null, scored: [], unscored: ["vare"] },
    };
  }

  it("swaps expensive slots to the cheapest meal until under the hard cap", () => {
    const byName = new Map([
      ["dyr ret", enriched("dyr ret", 100)],
      ["billig ret", enriched("billig ret", 10)],
    ]);
    const days = [
      [{ mealType: "dinner" as MealType, name: "dyr ret", leftoverOf: null, ingredients: [] }],
      [{ mealType: "dinner" as MealType, name: "dyr ret", leftoverOf: null, ingredients: [] }],
    ];
    const o = opts({ budget: 120, days: 2 });
    const build = (d: typeof days) =>
      assembleResult(
        d.map((dayMeals, i) => ({
          day: i + 1,
          meals: dayMeals.map((m) => ({
            mealType: m.mealType,
            recipe: byName.get(m.name) as EnrichedRecipe,
            leftover: m.leftoverOf !== null,
            cookedOnDay: m.leftoverOf ?? i + 1,
          })),
          kcalPerPerson: null,
        })),
        o,
        [],
      );

    const before = build(days);
    expect(before.feasible).toBe(false); // 200 kr > 120 kr

    const trimmed = trimToBudget(days, byName, o, build);
    expect(trimmed).not.toBeNull();
    expect(trimmed?.result.feasible).toBe(true);
    expect(trimmed?.swaps).toBeGreaterThan(0);
    expect(trimmed?.result.grandTotal).toBeLessThanOrEqual(120);
  });

  it("returns null when even all-cheapest cannot fit", () => {
    const byName = new Map([["billig ret", enriched("billig ret", 50)]]);
    const days = [
      [{ mealType: "dinner" as MealType, name: "billig ret", leftoverOf: null, ingredients: [] }],
      [{ mealType: "dinner" as MealType, name: "billig ret", leftoverOf: null, ingredients: [] }],
    ];
    const o = opts({ budget: 60, days: 2 });
    const build = (d: typeof days) =>
      assembleResult(
        d.map((dayMeals, i) => ({
          day: i + 1,
          meals: dayMeals.map((m) => ({
            mealType: m.mealType,
            recipe: byName.get(m.name) as EnrichedRecipe,
            leftover: false,
            cookedOnDay: i + 1,
          })),
          kcalPerPerson: null,
        })),
        o,
        [],
      );
    expect(trimToBudget(days, byName, o, build)).toBeNull();
  });
});
