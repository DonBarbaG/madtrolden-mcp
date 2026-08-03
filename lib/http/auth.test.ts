/** Security-pass tests (§9): ACCESS_KEYS parsing and key verification. */

import { describe, expect, it } from "vitest";
import { KEY_PATTERN, keyFingerprint, parseAccessKeys } from "./auth";

const GOOD_KEY = "troll_abcdefghij234567klmnop2345";

describe("parseAccessKeys", () => {
  it("parses valid comma-separated pairs", () => {
    const entries = parseAccessKeys(`ludwig:${GOOD_KEY},mor:troll_zyxwvutsrq765432ponmlk7654`);
    expect(entries.map((e) => e.name)).toEqual(["ludwig", "mor"]);
  });

  it("rejects an empty/missing env var loudly", () => {
    expect(() => parseAccessKeys(undefined)).toThrow(/ACCESS_KEYS is not set/);
    expect(() => parseAccessKeys("  ")).toThrow(/ACCESS_KEYS is not set/);
  });

  it("rejects entries without a separator, naming the position not the content", () => {
    expect(() => parseAccessKeys(`ludwigtroll_abc`)).toThrow(/entry 1 has no "name:key"/);
  });

  it("rejects malformed keys without echoing key material", () => {
    const bad = "ludwig:troll_tooshort";
    try {
      parseAccessKeys(bad);
      expect.unreachable("should throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("malformed key");
      expect(msg).not.toContain("tooshort");
    }
  });

  it("rejects stray commas and duplicate names", () => {
    expect(() => parseAccessKeys(`ludwig:${GOOD_KEY},,`)).toThrow(/empty/);
    expect(() =>
      parseAccessKeys(`ludwig:${GOOD_KEY},ludwig:troll_zyxwvutsrq765432ponmlk7654`),
    ).toThrow(/duplicate/);
  });

  it("rejects invalid account names", () => {
    expect(() => parseAccessKeys(`lud wig:${GOOD_KEY}`)).toThrow(/invalid account name/);
  });
});

describe("key format", () => {
  it("accepts only troll_ + 26 base32 chars", () => {
    expect(KEY_PATTERN.test(GOOD_KEY)).toBe(true);
    expect(KEY_PATTERN.test("troll_ABCDEFGHIJ234567KLMNOP2345")).toBe(false); // uppercase
    expect(KEY_PATTERN.test("troll_abcdefghij234567klmnop234")).toBe(false); // 25 chars
    expect(KEY_PATTERN.test("trol_abcdefghij234567klmnop23456")).toBe(false); // wrong prefix
    expect(KEY_PATTERN.test("troll_abcdefghij134567klmnop2345")).toBe(false); // '1' not in base32
  });
});

describe("keyFingerprint", () => {
  it("is short, deterministic, and not the key", () => {
    const fp = keyFingerprint(GOOD_KEY);
    expect(fp).toHaveLength(8);
    expect(fp).toBe(keyFingerprint(GOOD_KEY));
    expect(GOOD_KEY).not.toContain(fp);
  });
});
