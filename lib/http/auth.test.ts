/** Security-pass tests (§9): ACCESS_KEYS parsing and key verification. */

import { describe, expect, it } from "vitest";
import {
  KEY_PATTERN,
  keyFingerprint,
  keyFromCookie,
  loadAccessKeys,
  parseAccessKeys,
  sessionCookie,
} from "./auth";

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

describe("per-person keys + session cookie", () => {
  it("adds ACCESS_KEY_<NAME> vars to the shared list", () => {
    const entries = loadAccessKeys({
      ACCESS_KEYS: `ludwig:${GOOD_KEY}`,
      ACCESS_KEY_MOR: "troll_zyxwvutsrq765432ponmlk7654",
      ACCESS_KEY_: "ignored",
      OTHER: "x",
    });
    expect(entries.map((e) => e.name)).toEqual(["ludwig", "mor"]);
  });

  it("works with only per-person vars, and stays loud with none", () => {
    expect(loadAccessKeys({ ACCESS_KEY_MOR: GOOD_KEY }).map((e) => e.name)).toEqual(["mor"]);
    expect(() => loadAccessKeys({})).toThrow(/ACCESS_KEYS is not set/);
  });

  it("a per-person var for an existing account adds a second key, not a crash", () => {
    const entries = loadAccessKeys({
      ACCESS_KEYS: `ludwig:${GOOD_KEY}`,
      ACCESS_KEY_LUDWIG: "troll_zyxwvutsrq765432ponmlk7654",
    });
    expect(entries.map((e) => e.name)).toEqual(["ludwig", "ludwig"]);
  });

  it("a malformed per-person key still fails loudly", () => {
    expect(() => loadAccessKeys({ ACCESS_KEY_MOR: "troll_short" })).toThrow(/malformed key/);
  });

  it("round-trips the key through a long-lived HttpOnly cookie", () => {
    const cookie = sessionCookie(GOOD_KEY);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toMatch(/Max-Age=34560000/);
    expect(keyFromCookie(`a=1; ${cookie.split(";")[0]}; b=2`)).toBe(GOOD_KEY);
    expect(keyFromCookie("a=1")).toBeNull();
    expect(keyFromCookie(null)).toBeNull();
  });
});
