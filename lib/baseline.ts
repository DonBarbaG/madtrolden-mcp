// Baseline price estimates for staples (data/baseline-prices.json) — fixes
// the base repo's deals-only blindness: ingredients with no live deal used
// to cost 0 kr in every total. Estimates are conservative discount-chain
// prices; every total that uses them is labeled "estimated". A live deal
// always wins over a baseline estimate.

import baselineData from "../data/baseline-prices.json";
import { parseQuantity } from "./scoring";
import type { Ingredient } from "./store";

export interface BaselineItem {
  name: string;
  searchTerms: string[];
  unit: string; // "g" | "ml" | "stk"
  packSize: number;
  estimatePrice: number;
  category: string;
}

const ITEMS: BaselineItem[] = baselineData.items as BaselineItem[];

const termIndex = new Map<string, BaselineItem>();
for (const item of ITEMS) {
  for (const term of item.searchTerms) {
    const key = term.toLowerCase();
    if (!termIndex.has(key)) termIndex.set(key, item);
  }
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/** Find the baseline item for an ingredient (exact term first, then substring). */
export function findBaselineItem(
  ingredient: Pick<Ingredient, "name" | "searchTerms">,
): BaselineItem | null {
  const candidates = [ingredient.name, ...ingredient.searchTerms].map(normalize);
  for (const c of candidates) {
    const exact = termIndex.get(c);
    if (exact) return exact;
  }
  let best: BaselineItem | null = null;
  let bestLen = 0;
  for (const c of candidates) {
    for (const [term, item] of termIndex) {
      if (term.length > bestLen && (c.includes(term) || term.includes(c))) {
        best = item;
        bestLen = term.length;
      }
    }
  }
  return best;
}

/**
 * Fractional cost estimate for ranking recipes (unit price × amount needed).
 * Whole-pack register math happens at plan level via estimatePlanBaseline —
 * using fractions here keeps the solver smooth and deterministic.
 */
export function baselineFractionalCost(
  ingredient: Pick<Ingredient, "name" | "searchTerms" | "quantity">,
  recipeServings: number,
  householdSize: number,
): { item: BaselineItem; cost: number } | null {
  const item = findBaselineItem(ingredient);
  if (!item) return null;

  const scale = recipeServings > 0 ? householdSize / recipeServings : 1;
  const parsed = parseQuantity(ingredient.quantity);
  const unitPrice = item.estimatePrice / item.packSize;

  if (!parsed || parsed.unit !== item.unit) {
    // Unparseable ("efter smag", "1 fed") or unit mismatch: charge a modest
    // flat share of a pack rather than 0 or a whole pack.
    return { item, cost: Math.round(item.estimatePrice * 0.25 * 100) / 100 };
  }
  return { item, cost: Math.round(unitPrice * parsed.amount * scale * 100) / 100 };
}

export interface BaselineNeed {
  item: BaselineItem;
  /** Total amount needed in the item's unit; 0 when only unparseable amounts. */
  totalAmount: number;
  /** Count of unparseable contributions (charged as quarter packs). */
  unparseable: number;
}

export interface PlanBaseline {
  lines: Array<{ item: BaselineItem; packs: number; cost: number }>;
  total: number;
}

/**
 * Aggregate baseline needs across a whole plan into whole packs per item —
 * the honest register-total estimate for everything not covered by a deal.
 */
export function estimatePlanBaseline(
  needs: Array<{
    ingredient: Pick<Ingredient, "name" | "searchTerms" | "quantity">;
    recipeServings: number;
  }>,
  householdSize: number,
): PlanBaseline {
  const byItem = new Map<string, BaselineNeed>();

  for (const { ingredient, recipeServings } of needs) {
    const item = findBaselineItem(ingredient);
    if (!item) continue;
    const need = byItem.get(item.name) ?? { item, totalAmount: 0, unparseable: 0 };
    const parsed = parseQuantity(ingredient.quantity);
    const scale = recipeServings > 0 ? householdSize / recipeServings : 1;
    if (parsed && parsed.unit === item.unit) {
      need.totalAmount += parsed.amount * scale;
    } else {
      need.unparseable += 1;
    }
    byItem.set(item.name, need);
  }

  const lines: PlanBaseline["lines"] = [];
  let total = 0;
  for (const need of [...byItem.values()].sort((a, b) => a.item.name.localeCompare(b.item.name))) {
    // Unparseable contributions count as a quarter pack each toward the need.
    const effectiveAmount = need.totalAmount + need.unparseable * need.item.packSize * 0.25;
    const packs = Math.max(1, Math.ceil(effectiveAmount / need.item.packSize));
    const cost = packs * need.item.estimatePrice;
    lines.push({ item: need.item, packs, cost });
    total += cost;
  }
  return { lines, total: Math.round(total) };
}

export const BASELINE_NOTE =
  "Staple prices are conservative estimates (data/baseline-prices.json, user-editable) — totals using them are marked 'estimated'. Live deals always win over estimates.";
