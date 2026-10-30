/**
 * Unit tests for lib/on-hand.ts — parsing what the user has at home,
 * matching ingredients against it, and tallying how much the plan uses.
 */

import { describe, expect, it } from "vitest";
import { describeOnHand, matchOnHand, parseOnHand, tallyOnHand } from "./on-hand";

describe("parseOnHand", () => {
  it("reads amounts before and after the food, in many units", () => {
    const items = parseOnHand(
      "500 g hakket oksekød, 6 æg\n1,5 l mælk; ½ kg kartofler, spinat 200g, 2 kilo gulerødder",
    );
    expect(items).toEqual([
      { name: "hakket oksekød", amount: 500, unit: "g", raw: "500 g hakket oksekød" },
      { name: "æg", amount: 6, unit: "stk", raw: "6 æg" },
      { name: "mælk", amount: 1500, unit: "ml", raw: "1,5 l mælk" },
      { name: "kartofler", amount: 500, unit: "g", raw: "½ kg kartofler" },
      { name: "spinat", amount: 200, unit: "g", raw: "spinat 200g" },
      { name: "gulerødder", amount: 2000, unit: "g", raw: "2 kilo gulerødder" },
    ]);
  });

  it("keeps vague amounts as just the food", () => {
    const items = parseOnHand("en halv pose spinat, rest ris, noget ost");
    expect(items.map((i) => [i.name, i.amount])).toEqual([
      ["spinat", null],
      ["ris", null],
      ["ost", null],
    ]);
  });

  it("treats a bare number as a count, even before a multi-word food", () => {
    const [item] = parseOnHand("2 store løg");
    expect(item).toMatchObject({ name: "store løg", amount: 2, unit: "stk" });
  });

  it("dedupes, skips blanks, and caps the list", () => {
    expect(parseOnHand("æg, , æg,\n\n").map((i) => i.name)).toEqual(["æg"]);
    const many = Array.from({ length: 60 }, (_, i) => `vare${i}`).join(",");
    expect(parseOnHand(many)).toHaveLength(40);
  });
});

describe("matchOnHand", () => {
  const items = parseOnHand("500 g hakket oksekød, æg, spinat, kylling, ost");

  it("matches via name or search terms, in either direction", () => {
    expect(matchOnHand({ name: "oksekød", searchTerms: [] }, items)?.name).toBe("hakket oksekød");
    expect(matchOnHand({ name: "frisk spinat" }, items)?.name).toBe("spinat");
    expect(matchOnHand({ name: "kyllingebryst" }, items)?.name).toBe("kylling");
    expect(matchOnHand({ name: "Æg" }, items)?.name).toBe("æg");
  });

  it("never lets a short word swallow a longer one", () => {
    expect(matchOnHand({ name: "ægte vaniljesukker" }, items)).toBeNull();
    expect(matchOnHand({ name: "hakket svinekød" }, items)).toBeNull();
    expect(matchOnHand({ name: "østers" }, items)).toBeNull();
  });
});

describe("tallyOnHand", () => {
  const items = parseOnHand("500 g hakket oksekød, 6 æg, spinat");
  const lookup = (name: string) => items.find((i) => name.startsWith(i.name)) ?? null;

  it("reports what was used where, and what's still in the fridge", () => {
    const report = tallyOnHand(
      [
        { name: "Chili", ingredients: [{ name: "hakket oksekød", quantity: "300 g" }] },
        { name: "Chili", ingredients: [{ name: "hakket oksekød", quantity: "200 g" }] },
        { name: "Omelet", ingredients: [{ name: "æg", quantity: "4 stk" }] },
      ],
      items,
      lookup,
    );
    expect(report.used).toEqual([
      { name: "hakket oksekød", raw: "500 g hakket oksekød", meals: ["Chili"] },
      { name: "æg", raw: "6 æg", meals: ["Omelet"] },
    ]);
    expect(report.unused).toEqual(["spinat"]);
    expect(report.short).toEqual([]);
  });

  it("flags using more than the user has (beyond 10% slack)", () => {
    const report = tallyOnHand(
      [
        { name: "Omelet", ingredients: [{ name: "æg", quantity: "6 stk" }] },
        { name: "Pandekager", ingredients: [{ name: "æg", quantity: "3 stk" }] },
        { name: "Burger", ingredients: [{ name: "hakket oksekød", quantity: "540 g" }] },
      ],
      items,
      lookup,
    );
    expect(report.short).toEqual([{ name: "æg", have: "6 stk", need: "9 stk" }]);
  });

  it("can't sum mismatched units, so it never claims a shortage there", () => {
    const report = tallyOnHand(
      [{ name: "Omelet", ingredients: [{ name: "æg", quantity: "400 g" }] }],
      items,
      lookup,
    );
    expect(report.short).toEqual([]);
  });
});

describe("describeOnHand", () => {
  it("lists items with readable amounts", () => {
    expect(describeOnHand(parseOnHand("1500 g kartofler, æg"))).toBe("kartofler (1.5 kg), æg");
  });
});
