/** Security-pass tests (§9): token buckets actually limit and recover. */

import { beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits, takeToken } from "./rate-limit";

describe("takeToken", () => {
  beforeEach(() => resetRateLimits());

  it("allows 60 requests per key, then returns retry-after", () => {
    for (let i = 0; i < 60; i++) {
      expect(takeToken("ludwig").ok).toBe(true);
    }
    const blocked = takeToken("ludwig");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it("keeps per-key buckets independent", () => {
    for (let i = 0; i < 60; i++) takeToken("ludwig");
    expect(takeToken("ludwig").ok).toBe(false);
    expect(takeToken("mor").ok).toBe(true);
  });

  it("enforces the global cap across keys", () => {
    // 5 keys × 60 = 300 = global capacity; the 301st call anywhere fails.
    for (let k = 0; k < 5; k++) {
      for (let i = 0; i < 60; i++) {
        takeToken(`key${k}`);
      }
    }
    expect(takeToken("fresh-key").ok).toBe(false);
  });
});
