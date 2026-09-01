// Shared in-memory token-bucket rate limiter. Pure logic, no Express — the
// middleware wrapper lives in middleware/rateLimit.ts, and rateLimit.test.ts
// exercises this class directly (`npm test` only runs src/lib/*.test.ts).
//
// A bucket holds `max` tokens and refills at max/windowMs per millisecond, so
// it absorbs a burst of `max` and returns to full after `windowMs` of silence.
// That equivalence is what makes eviction safe: a bucket untouched for a full
// window has refilled to `max`, which is exactly what a freshly minted bucket
// holds — so dropping it changes nothing a caller can observe.
//
// In-memory is fine for the single-process backend; horizontal scaling would
// need a shared store (Redis) since each instance would keep its own buckets.

export interface RateLimitOptions {
  /** Time for an empty bucket to refill completely. */
  windowMs: number;
  /** Bucket capacity — the burst size, and the sustained rate per window. */
  max: number;
}

interface Bucket {
  tokens: number;
  last: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly refillPerMs: number;
  private lastSweep: number;

  constructor(private readonly opts: RateLimitOptions, now: number = Date.now()) {
    this.refillPerMs = opts.max / opts.windowMs;
    this.lastSweep = now;
  }

  /**
   * Consume one token from every key, all-or-nothing: if any key is out of
   * tokens the request is rejected and none are debited. Multiple keys let a
   * single request be limited on independent dimensions (e.g. IP *and* email)
   * without one dimension draining the other's budget.
   *
   * Returns false when the request should be rejected.
   */
  tryConsume(keys: string | string[], now: number = Date.now()): boolean {
    this.sweep(now);

    const list = typeof keys === 'string' ? [keys] : keys;
    const refilled = list.map((key) => [key, this.refill(key, now)] as const);

    // Persist the refill either way — the clock has moved on regardless of the
    // verdict, and an unpersisted refill would restart the bucket's timeline.
    const allowed = refilled.every(([, bucket]) => bucket.tokens >= 1);
    for (const [key, bucket] of refilled) {
      if (allowed) bucket.tokens -= 1;
      this.buckets.set(key, bucket);
    }
    return allowed;
  }

  private refill(key: string, now: number): Bucket {
    const bucket = this.buckets.get(key) ?? { tokens: this.opts.max, last: now };
    return {
      tokens: Math.min(this.opts.max, bucket.tokens + (now - bucket.last) * this.refillPerMs),
      last: now,
    };
  }

  /**
   * Drop buckets idle for a full window, so the map can't grow without bound
   * on a long-lived process. Amortized to at most one pass per window.
   */
  sweep(now: number = Date.now()): void {
    if (now - this.lastSweep < this.opts.windowMs) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.last >= this.opts.windowMs) this.buckets.delete(key);
    }
  }

  /** Tracked key count — for tests and observability. */
  get size(): number {
    return this.buckets.size;
  }
}
