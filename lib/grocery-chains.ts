// Which Tjek "brands" are places you can actually buy food. Tjek's /stores
// returns every branch with a flyer — JYSK, Matas, IKEA… — and its dealer
// records carry no category, so this is a curated list (names exactly as
// Tjek spells them, matched case-insensitively). Border shops are included:
// the radius filter decides whether they're relevant.

export const GROCERY_CHAINS: readonly string[] = [
  "365discount",
  "ABC Lavpris",
  "Bilka",
  "Brugsen",
  "Coop",
  "Fleggaard",
  "BorderShop",
  "Poetzsch Padborg",
  "fakta Tyskland",
  "føtex",
  "Gpris",
  "Kaufland",
  "Købmandsgården",
  "Kvickly",
  "LET-KØB",
  "Lidl",
  "Løvbjerg",
  "MENY",
  "Min Købmand",
  "Netto",
  "Penny",
  "Prima Lavpris",
  "REMA 1000",
  "Rewe",
  "SPAR",
  "SuperBrugsen",
];

const GROCERY_SET = new Set(GROCERY_CHAINS.map((c) => c.trim().toLowerCase()));

/** True when a Tjek brand name is a grocery chain (case-insensitive). */
export function isGroceryChain(brand: string): boolean {
  return GROCERY_SET.has(brand.trim().toLowerCase());
}
