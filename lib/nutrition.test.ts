/** Tests for the Frida-derived nutrition lookup and per-recipe kcal math. */

import { describe, expect, it } from "vitest";
import { computeRecipeNutrition, findNutrition, gramsFor } from "./nutrition";

describe("findNutrition", () => {
  it("matches by exact alias", () => {
    const entry = findNutrition({ name: "hakket oksekød", searchTerms: [] });
    expect(entry?.fridaFood).toContain("Oksekød, hakket");
  });

  it("matches via searchTerms when the name is fancy", () => {
    const entry = findNutrition({ name: "kød til bolognese", searchTerms: ["hakket oksekød"] });
    expect(entry?.fridaFood).toContain("Oksekød, hakket");
  });

  it("prefers the longest alias on substring matches", () => {
    // "hakket oksekød i skiver" contains both "oksekød" and "hakket oksekød".
    const entry = findNutrition({ name: "hakket oksekød, magert", searchTerms: [] });
    expect(entry?.name).toBe("hakket oksekød");
  });

  it("returns null for unknown ingredients", () => {
    expect(findNutrition({ name: "enhjørningstøv", searchTerms: ["stjerneskud"] })).toBeNull();
  });
});

describe("gramsFor / computeRecipeNutrition", () => {
  it("computes kcal per serving from weights", () => {
    // 500 g pasta (~361 kcal/100g) + 400 g dåsetomater (~21 kcal/100g) / 4 servings
    const result = computeRecipeNutrition({
      servings: 4,
      ingredients: [
        { name: "pasta", searchTerms: ["pasta"], quantity: "500 g" },
        { name: "hakkede tomater", searchTerms: ["dåsetomater"], quantity: "400 g" },
      ],
    });
    expect(result.perServing).not.toBeNull();
    expect(result.perServing?.kcal).toBeGreaterThan(400);
    expect(result.perServing?.kcal).toBeLessThan(550);
    expect(result.scored).toHaveLength(2);
    expect(result.unscored).toHaveLength(0);
  });

  it("handles stk via piece weights (æg)", () => {
    const entry = findNutrition({ name: "æg", searchTerms: [] });
    expect(entry).not.toBeNull();
    if (entry) {
      expect(gramsFor("4 stk", entry)).toBe(240);
    }
  });

  it("lists unmatched and unparseable ingredients as unscored", () => {
    const result = computeRecipeNutrition({
      servings: 2,
      ingredients: [
        { name: "pasta", searchTerms: ["pasta"], quantity: "200 g" },
        { name: "hemmelig krydderi", searchTerms: [], quantity: "1 knivspids" },
        { name: "kærlighed", searchTerms: [], quantity: "efter smag" },
      ],
    });
    expect(result.scored).toEqual(["pasta"]);
    expect(result.unscored).toEqual(["hemmelig krydderi", "kærlighed"]);
  });

  it("returns null perServing when nothing can be scored", () => {
    const result = computeRecipeNutrition({
      servings: 2,
      ingredients: [{ name: "mystik", searchTerms: [], quantity: "lidt" }],
    });
    expect(result.perServing).toBeNull();
  });
});
