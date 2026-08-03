// Tiny in-RAM TTL cache. This is the only "storage" the server has —
// shared across accounts for upstream API responses, wiped on cold start.
// Logs hits/misses to stderr so cache behavior is visible in Vercel logs
// without ever polluting the stdio MCP channel.

interface CacheEntry<V> {
  value: V;
  storedAt: number;
}

export class TtlCache<V> {
  private map = new Map<string, CacheEntry<V>>();

  constructor(
    private ttlMs: number,
    private label: string,
    private maxEntries = 500,
  ) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      // Evict oldest insertion — good enough for a bounded convenience cache.
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, storedAt: Date.now() });
  }

  async getOrFetch(key: string, fetcher: () => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) {
      console.error(`[cache] hit ${this.label} ${key}`);
      return hit;
    }
    console.error(`[cache] miss ${this.label} ${key}`);
    const value = await fetcher();
    this.set(key, value);
    return value;
  }

  clear(): void {
    this.map.clear();
  }
}
