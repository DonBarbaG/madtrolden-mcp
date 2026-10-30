// "Det har jeg allerede" — food the user already has at home (fridge,
// freezer, cupboard), typed as free text. Unlike the pantry (staples that
// are simply left off shopping lists), on-hand food STEERS the plan: meals
// are built around it so it gets used up, it costs 0 kr, and the shopping
// list only carries what's missing.
//
// Pure atoms, no IO — parse the free text, match recipe ingredients against
// it, check the plan doesn't use more than is there, and report what was
// used and what's still sitting in the fridge.

import { parseQuantity } from "./scoring";

export interface OnHandItem {
  /** Lowercased food name without the amount ("hakket oksekød"). */
  name: string;
  /** Amount in base units (g / ml / stk), null when not given or vague. */
  amount: number | null;
  unit: "g" | "ml" | "stk" | null;
  /** The user's own words for the line, shown back in the UI. */
  raw: string;
}

/** Max items — keeps the AI prompt bounded. */
export const ON_HAND_LIMIT = 40;

/** Suffix that marks an invented ingredient as coming from the user's fridge. */
export const ON_HAND_MARK = " (har du)";

const UNIT_WORDS: Record<string, string> = {
  gram: "g",
  gr: "g",
  kilo: "kg",
  liter: "l",
  stk: "stk",
  styk: "stk",
  stykker: "stk",
};

// Words that carry no food meaning in "en halv pose spinat".
const FILLER = new Set([
  "en",
  "et",
  "halv",
  "halvt",
  "lidt",
  "noget",
  "pose",
  "poser",
  "pakke",
  "pakker",
  "dåse",
  "dåser",
  "bakke",
  "bundt",
  "glas",
  "rest",
  "rester",
  "af",
  "med",
]);

function toBase(amount: number, unit: string): { amount: number; unit: OnHandItem["unit"] } | null {
  const word = UNIT_WORDS[unit] ?? unit;
  const parsed = parseQuantity(`${amount} ${word}`);
  if (!parsed) return null;
  if (parsed.unit !== "g" && parsed.unit !== "ml" && parsed.unit !== "stk") return null;
  return { amount: parsed.amount, unit: parsed.unit };
}

function parseLine(raw: string): OnHandItem | null {
  const line = raw.trim().replace(/\s+/g, " ");
  if (line === "") return null;
  const lower = line.toLowerCase();

  let amount: number | null = null;
  let unit: OnHandItem["unit"] = null;
  let rest = lower;

  // "500 g hakket oksekød", "500g oksekød", "1,5 l mælk", "6 æg", "½ kg kartofler"
  const lead = lower.match(/^(½|\d+(?:[.,]\d+)?)\s*([a-zæøå]+\.?)?\s+(.*)$/);
  // "hakket oksekød 500 g", "æg 6 stk", "æg x6"
  const tail = lower.match(/^(.*?)\s+x?(½|\d+(?:[.,]\d+)?)\s*([a-zæøå]+)?$/);
  const num = (s: string) => (s === "½" ? 0.5 : Number.parseFloat(s.replace(",", ".")));

  if (lead) {
    const n = num(lead[1]);
    const word = (lead[2] ?? "").replace(".", "");
    const base = word ? toBase(n, word) : null;
    if (base) {
      amount = base.amount;
      unit = base.unit;
      rest = lead[3];
    } else {
      // Bare count ("6 æg") — the unit word was actually the food's first word.
      amount = n;
      unit = "stk";
      rest = word ? `${word} ${lead[3]}` : lead[3];
    }
  } else if (tail) {
    const n = num(tail[2]);
    const base = tail[3] ? toBase(n, tail[3]) : { amount: n, unit: "stk" as const };
    if (base) {
      amount = base.amount;
      unit = base.unit;
      rest = tail[1];
    }
  }

  const name = rest
    .split(" ")
    .filter((w) => w !== "" && !FILLER.has(w))
    .join(" ")
    .trim();
  if (!/[a-zæøå]/.test(name)) return null;
  if (amount !== null && !(amount > 0)) {
    amount = null;
    unit = null;
  }
  return { name, amount, unit, raw: line };
}

/** Free text ("500 g hakket oksekød, 6 æg\nhalv pose spinat") → items. */
export function parseOnHand(text: string): OnHandItem[] {
  const byName = new Map<string, OnHandItem>();
  // Commas separate items — except a decimal comma ("1,5 l mælk").
  for (const part of text.split(/[\n;]+|(?<!\d),|,(?!\d)/)) {
    const item = parseLine(part);
    if (!item || byName.has(item.name)) continue;
    byName.set(item.name, item);
    if (byName.size >= ON_HAND_LIMIT) break;
  }
  return [...byName.values()];
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-zæøå0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w.length > 0);
}

/** One word "is" another when equal, or a Danish compound/inflection prefix
 * ("kylling" ↔ "kyllingebryst", "tomat" ↔ "tomater"). Short words must be
 * exact so "æg" never eats "ægte" and "ris" never eats "rismel". */
function wordMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

/** Every word of `needle` appears (wordMatches) in `hay`. */
function phraseIn(needle: string[], hay: string[]): boolean {
  return needle.length > 0 && needle.every((n) => hay.some((h) => wordMatches(n, h)));
}

/** Which on-hand item (if any) an ingredient is. */
export function matchOnHand(
  ingredient: { name: string; searchTerms?: string[] },
  items: OnHandItem[],
): OnHandItem | null {
  const candidates = [ingredient.name, ...(ingredient.searchTerms ?? [])].map(words);
  for (const item of items) {
    const itemWords = words(item.name);
    for (const c of candidates) {
      // Either direction: "hakket oksekød" (fridge) ↔ "oksekød" (term), or
      // "spinat" (fridge) ↔ "frisk spinat" (ingredient).
      if (phraseIn(itemWords, c) || phraseIn(c, itemWords)) return item;
    }
  }
  return null;
}

export interface OnHandUse {
  item: OnHandItem;
  /** Amount the plan uses in the item's unit; null when not comparable. */
  used: number | null;
  /** Dish names that use it. */
  meals: string[];
}

export interface OnHandReport {
  used: Array<{ name: string; raw: string; meals: string[] }>;
  unused: string[];
  /** Items the plan uses more of than the user has. */
  short: Array<{ name: string; have: string; need: string }>;
}

function fmt(amount: number, unit: string): string {
  if (unit === "g" && amount >= 1000) return `${Math.round(amount / 100) / 10} kg`;
  if (unit === "ml" && amount >= 1000) return `${Math.round(amount / 100) / 10} l`;
  return `${Math.round(amount)} ${unit}`;
}

/**
 * Tally on-hand use across every planned meal — a leftover portion is food
 * too (the batch was cooked bigger), so it counts like a fresh one. Give the
 * ingredient quantities for ONE meal of the whole household. `lookup` says
 * which item an ingredient is (null = not from the fridge).
 */
export function tallyOnHand(
  meals: Array<{ name: string; ingredients: Array<{ name: string; quantity: string }> }>,
  items: OnHandItem[],
  lookup: (ingredientName: string) => OnHandItem | null,
): OnHandReport {
  const uses = new Map<string, OnHandUse>();
  for (const meal of meals) {
    for (const ing of meal.ingredients) {
      const item = lookup(ing.name);
      if (!item) continue;
      const use = uses.get(item.name) ?? { item, used: 0, meals: [] };
      if (!use.meals.includes(meal.name)) use.meals.push(meal.name);
      const parsed = parseQuantity(ing.quantity);
      if (use.used !== null && parsed && parsed.unit === item.unit) {
        use.used += parsed.amount;
      } else {
        use.used = null; // units don't line up — can't honestly sum
      }
      uses.set(item.name, use);
    }
  }

  const short: OnHandReport["short"] = [];
  for (const u of uses.values()) {
    const { amount, unit } = u.item;
    // 10% slack — nobody weighs the last bit of spinach.
    if (u.used !== null && amount !== null && unit !== null && u.used > amount * 1.1) {
      short.push({ name: u.item.name, have: fmt(amount, unit), need: fmt(u.used, unit) });
    }
  }

  return {
    used: [...uses.values()].map((u) => ({ name: u.item.name, raw: u.item.raw, meals: u.meals })),
    unused: items.filter((i) => !uses.has(i.name)).map((i) => i.name),
    short,
  };
}

/** Prompt lines describing the fridge for the AI planner. */
export function describeOnHand(items: OnHandItem[]): string {
  return items
    .map((i) =>
      i.amount !== null && i.unit !== null ? `${i.name} (${fmt(i.amount, i.unit)})` : i.name,
    )
    .join(", ");
}
