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
// ponytail: in-memory, so each process keeps its own buckets. Correct for one
// long-lived process (local dev, `npm test`), useless on Netlify Functions,
// where every invocation starts with empty buckets and concurrent invocations
// never share a budget. Production therefore runs postgresRateLimit.ts, which
// puts the same buckets in a table every invocation can see; this class stays
// as the non-production limiter and as that one's fallback when the database
// is unreachable.
//
// The bucket arithmetic itself lives in the three pure functions below, and
// BOTH limiters call them — a second copy of the refill formula for the shared
// store would be free to drift away from the one the tests pin.

export interface RateLimitOptions {
  /** Time for an empty bucket to refill completely. */
  windowMs: number;
  /** Bucket capacity — the burst size, and the sustained rate per window. */
  max: number;
  /**
   * Hard ceiling on tracked keys. Time-based eviction alone is not enough when
   * the key is partly caller-controlled (an IP header can be forged), because
   * `sweep` runs at most once per window — for a 15-minute window that leaves a
   * long gap to insert keys into. At the cap the oldest buckets are dropped,
   * which is safe for the same reason `sweep` is: a dropped bucket is
   * indistinguishable from a fresh one.
   */
  maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 10_000;

/** A bucket's token count, and the instant that count was computed. */
export interface Bucket {
  tokens: number;
  last: number;
}

/**
 * The bucket's state at `now`. `undefined` means "never seen", which is
 * indistinguishable from a full bucket — the equivalence every eviction path
 * here relies on.
 *
 * Idempotent: refilling to t1 and then to t2 lands on exactly the same token
 * count as refilling straight to t2, clamp included. That is why a limiter may
 * decline a request and write nothing at all — the refill it computed is not a
 * lost update, just work the next reader repeats.
 */
export function refill(
  bucket: Bucket | undefined,
  now: number,
  max: number,
  refillPerMs: number,
): Bucket {
  const from = bucket ?? { tokens: max, last: now };
  return { tokens: Math.min(max, from.tokens + (now - from.last) * refillPerMs), last: now };
}

/**
 * The all-or-nothing verdict. A request spends one token from every dimension
 * it is limited on, so it is admitted only when all of them can pay — and when
 * one cannot, none are debited. That is what stops a drained shared arm (an IP,
 * or the global forgot-password cap) from also draining the budget of the
 * specific email it happened to arrive with.
 */
export function allowsAll(buckets: readonly Bucket[]): boolean {
  return buckets.every((bucket) => bucket.tokens >= 1);
}

/**
 * The instant this bucket refills to capacity. Past it the row is
 * indistinguishable from one that never existed, so deleting it grants nobody
 * anything — the same argument that makes `sweep` and `evictFull` safe. The
 * shared store persists this so cleanup is one indexed range scan that needs no
 * idea which limiter owns the row.
 */
export function fullAt(bucket: Bucket, max: number, refillPerMs: number): number {
  return bucket.last + (max - bucket.tokens) / refillPerMs;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly refillPerMs: number;
  private readonly maxKeys: number;
  private lastSweep: number;

  constructor(private readonly opts: RateLimitOptions, now: number = Date.now()) {
    this.refillPerMs = opts.max / opts.windowMs;
    this.maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
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

    // Admitting a new key would exceed the cap: reclaim what is safe to reclaim,
    // and if that is not enough, reject rather than evict a partly-spent bucket.
    //
    // ponytail: failing closed means that under a sustained flood of forged keys
    // a genuinely new caller can be turned away. That is the honest trade for an
    // in-memory map with a partly caller-controlled key space, and it is bounded
    // - flooded buckets refill and become evictable within one window. The real
    // fix is a shared store where the key space is the database's problem; see
    // the note at the top of this file.
    const incoming = list.filter((key) => !this.buckets.has(key)).length;
    if (incoming > 0 && this.buckets.size + incoming > this.maxKeys) {
      this.evictFull(now);
      if (this.buckets.size + incoming > this.maxKeys) return false;
    }
    const refilled = list.map(
      (key) => [key, refill(this.buckets.get(key), now, this.opts.max, this.refillPerMs)] as const,
    );

    // Persist the refill either way — the clock has moved on regardless of the
    // verdict, and an unpersisted refill would restart the bucket's timeline.
    const allowed = allowsAll(refilled.map(([, bucket]) => bucket));
    for (const [key, bucket] of refilled) {
      if (allowed) bucket.tokens -= 1;
      this.buckets.set(key, bucket);
    }
    return allowed;
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

  /**
   * Drop buckets that have refilled to capacity. Safe for exactly the reason
   * `sweep` is safe: a full bucket is indistinguishable from one that never
   * existed, so dropping it grants nobody anything.
   *
   * Deliberately NOT least-recently-used. LRU looks like the obvious policy and
   * is wrong here: a partly-spent bucket is the record of someone's spent
   * budget, so evicting it RESETS their limit. That hands an attacker the
   * bypass the cap exists to prevent — flood unique keys, push the victim's
   * bucket out, and their allowance comes back. Caught by
   * "does not let a flood of forged keys reset the bucket being charged".
   */
  private evictFull(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (refill(bucket, now, this.opts.max, this.refillPerMs).tokens >= this.opts.max) {
        this.buckets.delete(key);
      }
    }
  }

  /** Tracked key count — for tests and observability. */
  get size(): number {
    return this.buckets.size;
  }
}
