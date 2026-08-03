// Nutrition lookup backed by data/nutrition.json (derived from Frida/DTU,
// CC BY 4.0 — see the JSON header for full attribution). Matching is by
// alias: recipe ingredient names/searchTerms vs. curated alias lists.
// Unmatched ingredients contribute 0 kcal and are reported as "un-scored"
// so the user knows the confidence of every kcal number.

import nutritionData from "../data/nutrition.json";
import { parseQuantity } from "./scoring";
import type { Ingredient } from "./store";

export interface MacrosPer100g {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface NutritionEntry {
  name: string;
  aliases: string[];
  fridaFood: string;
  per100g: MacrosPer100g;
}

export interface RecipeNutrition {
  /** Per single serving; null when nothing could be scored. */
  perServing: MacrosPer100g | null;
  /** Ingredient names that contributed to the numbers. */
  scored: string[];
  /** Ingredient names that could NOT be scored (no match or no parseable amount). */
  unscored: string[];
}

const ENTRIES: NutritionEntry[] = nutritionData.ingredients as NutritionEntry[];

const aliasIndex = new Map<string, NutritionEntry>();
for (const entry of ENTRIES) {
  for (const alias of entry.aliases) {
    if (!aliasIndex.has(alias)) aliasIndex.set(alias, entry);
  }
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/** Find the nutrition entry for an ingredient (exact alias first, then substring). */
export function findNutrition(
  ingredient: Pick<Ingredient, "name" | "searchTerms">,
): NutritionEntry | null {
  const candidates = [ingredient.name, ...ingredient.searchTerms].map(normalize);
  for (const c of candidates) {
    const exact = aliasIndex.get(c);
    if (exact) return exact;
  }
  // Substring pass: longest alias wins so "hakket oksekød" beats "oksekød".
  let best: NutritionEntry | null = null;
  let bestLen = 0;
  for (const c of candidates) {
    for (const [alias, entry] of aliasIndex) {
      if (alias.length > bestLen && (c.includes(alias) || alias.includes(c))) {
        best = entry;
        bestLen = alias.length;
      }
    }
  }
  return best;
}

// Approximate per-piece weights (grams) for ingredients recipes give in "stk".
const PIECE_WEIGHTS_G: Record<string, number> = {
  æg: 60,
  løg: 100,
  hvidløg: 5, // a clove
  gulerødder: 75,
  tomat: 120,
  agurk: 300,
  peberfrugt: 150,
  icebergsalat: 400,
  squash: 300,
  aubergine: 300,
  porrer: 150,
  citron: 60,
  lime: 50,
  æble: 150,
  banan: 120,
  appelsin: 150,
  pære: 160,
  avocado: 140,
  mango: 300,
  broccoli: 300,
  blomkål: 600,
  hvidkål: 1200,
  spidskål: 800,
  rødkål: 1000,
  forårsløg: 15,
  "frisk chili": 10,
  tortilla: 60,
  wienerpølser: 50,
  bouillon: 10, // a cube
};

/** Grams represented by a recipe quantity string for a given nutrition entry, or null. */
export function gramsFor(quantity: string, entry: NutritionEntry): number | null {
  const parsed = parseQuantity(quantity);
  if (!parsed) return null;
  if (parsed.unit === "g") return parsed.amount;
  if (parsed.unit === "ml") return parsed.amount; // ≈1 g/ml for kitchen liquids
  if (parsed.unit === "stk") {
    const per = PIECE_WEIGHTS_G[entry.name];
    return per ? parsed.amount * per : null;
  }
  return null;
}

/**
 * Compute macros per serving for a recipe. Pantry items are typically
 * negligible; anything unmatched/unparseable lands in `unscored`.
 */
export function computeRecipeNutrition(recipe: {
  servings: number;
  ingredients: Pick<Ingredient, "name" | "searchTerms" | "quantity">[];
}): RecipeNutrition {
  const scored: string[] = [];
  const unscored: string[] = [];
  const total: MacrosPer100g = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

  for (const ing of recipe.ingredients) {
    const entry = findNutrition(ing);
    const grams = entry ? gramsFor(ing.quantity, entry) : null;
    if (!entry || grams === null) {
      unscored.push(ing.name);
      continue;
    }
    const f = grams / 100;
    total.kcal += entry.per100g.kcal * f;
    total.protein += entry.per100g.protein * f;
    total.fat += entry.per100g.fat * f;
    total.carbs += entry.per100g.carbs * f;
    scored.push(ing.name);
  }

  if (scored.length === 0) {
    return { perServing: null, scored, unscored };
  }
  const servings = recipe.servings > 0 ? recipe.servings : 1;
  return {
    perServing: {
      kcal: Math.round(total.kcal / servings),
      protein: Math.round((total.protein / servings) * 10) / 10,
      fat: Math.round((total.fat / servings) * 10) / 10,
      carbs: Math.round((total.carbs / servings) * 10) / 10,
    },
    scored,
    unscored,
  };
}

export const NUTRITION_ATTRIBUTION =
  "Nutrition data: The Danish Food Composition Database (Frida) v6.1, DTU Fødevareinstituttet, DOI 10.11583/DTU.32312844, CC BY 4.0";
