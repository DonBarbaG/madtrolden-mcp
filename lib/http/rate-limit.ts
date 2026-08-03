// In-memory token buckets: per-account and global. Per-instance and
// approximate by design — at friends-and-family scale this only needs to
// stop runaway loops and keep the server a polite Tjek-API citizen.

const PER_KEY_CAPACITY = 60; // requests
const PER_KEY_REFILL_PER_MS = 60 / 60_000; // 60/min
const GLOBAL_CAPACITY = 300;
const GLOBAL_REFILL_PER_MS = 300 / 60_000; // 300/min

interface Bucket {
  tokens: number;
  last: number;
}

const perKeyBuckets = new Map<string, Bucket>();
const globalBucket: Bucket = { tokens: GLOBAL_CAPACITY, last: Date.now() };

function refill(bucket: Bucket, capacity: number, ratePerMs: number, now: number): void {
  bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.last) * ratePerMs);
  bucket.last = now;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export function takeToken(account: string): RateLimitResult {
  const now = Date.now();

  refill(globalBucket, GLOBAL_CAPACITY, GLOBAL_REFILL_PER_MS, now);
  let bucket = perKeyBuckets.get(account);
  if (!bucket) {
    bucket = { tokens: PER_KEY_CAPACITY, last: now };
    perKeyBuckets.set(account, bucket);
  } else {
    refill(bucket, PER_KEY_CAPACITY, PER_KEY_REFILL_PER_MS, now);
  }

  if (bucket.tokens < 1) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((1 - bucket.tokens) / PER_KEY_REFILL_PER_MS / 1000),
    };
  }
  if (globalBucket.tokens < 1) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((1 - globalBucket.tokens) / GLOBAL_REFILL_PER_MS / 1000),
    };
  }

  bucket.tokens -= 1;
  globalBucket.tokens -= 1;
  return { ok: true };
}

/** Test hook. */
export function resetRateLimits(): void {
  perKeyBuckets.clear();
  globalBucket.tokens = GLOBAL_CAPACITY;
  globalBucket.last = Date.now();
}
