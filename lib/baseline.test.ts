/** Tests for baseline (deals-blindness fix) price estimates. */

import { describe, expect, it } from "vitest";
import { baselineFractionalCost, estimatePlanBaseline, findBaselineItem } from "./baseline";

describe("findBaselineItem", () => {
  it("matches by exact search term", () => {
    const item = findBaselineItem({ name: "kartofler", searchTerms: [] });
    expect(item?.name).toBe("kartofler");
  });

  it("matches via recipe searchTerms", () => {
    const item = findBaselineItem({ name: "øko skruer", searchTerms: ["pasta"] });
    expect(item?.name).toBe("pasta");
  });

  it("returns null for unknown items", () => {
    expect(findBaselineItem({ name: "guldstøv", searchTerms: [] })).toBeNull();
  });
});

describe("baselineFractionalCost", () => {
  it("charges unit price × scaled amount for parseable quantities", () => {
    // pasta: 9 kr / 500 g → 400 g for 4 servings, household 2 → 200 g → ~3.6 kr
    const result = baselineFractionalCost(
      { name: "pasta", searchTerms: ["pasta"], quantity: "400 g" },
      4,
      2,
    );
    expect(result).not.toBeNull();
    expect(result?.cost).toBeCloseTo((9 / 500) * 200, 1);
  });

  it("charges a quarter pack for unparseable quantities", () => {
    const result = baselineFractionalCost(
      { name: "pasta", searchTerms: ["pasta"], quantity: "efter smag" },
      4,
      2,
    );
    expect(result?.cost).toBeCloseTo(9 * 0.25, 2);
  });
});

describe("estimatePlanBaseline", () => {
  it("aggregates needs across recipes into whole packs", () => {
    // 2 × 400 g pasta for 2 servings each, household 2 → 800 g → 2 packs of 500 g = 18 kr
    const plan = estimatePlanBaseline(
      [
        {
          ingredient: { name: "pasta", searchTerms: ["pasta"], quantity: "400 g" },
          recipeServings: 2,
        },
        {
          ingredient: { name: "pasta", searchTerms: ["pasta"], quantity: "400 g" },
          recipeServings: 2,
        },
      ],
      2,
    );
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].packs).toBe(2);
    expect(plan.total).toBe(18);
  });

  it("always buys at least one pack per needed item", () => {
    const plan = estimatePlanBaseline(
      [
        {
          ingredient: { name: "pasta", searchTerms: ["pasta"], quantity: "50 g" },
          recipeServings: 2,
        },
      ],
      2,
    );
    expect(plan.lines[0].packs).toBe(1);
  });

  it("skips ingredients with no baseline match", () => {
    const plan = estimatePlanBaseline(
      [
        {
          ingredient: { name: "safran fra Mars", searchTerms: [], quantity: "1 g" },
          recipeServings: 2,
        },
      ],
      2,
    );
    expect(plan.lines).toHaveLength(0);
    expect(plan.total).toBe(0);
  });
});
