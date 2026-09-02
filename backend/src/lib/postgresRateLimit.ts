// Token buckets held in Postgres, so every Netlify Function invocation spends
// from the same budget instead of each one starting with an empty map. Same
// public surface as RateLimiter (createRateLimit takes either) and the same
// bucket arithmetic — both call the pure helpers in rateLimit.ts.
//
// Raw SQL rather than the generated client: the debit has to be one atomic
// read-lock-write per key, which a read-then-write through the model API cannot
// express without reopening the race this class exists to close.

import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { prisma } from './prisma';
import { allowsAll, fullAt, refill, RateLimiter, RateLimitOptions } from './rateLimit';

// The cleanup predicate is absolute ("full_at has passed"), not relative to a
// window, so this interval is purely a cost knob: it caps how many rows a burst
// of single-use keys can leave lying about. A minute's worth is far fewer than
// a 15-minute window's worth, and the delete is one indexed range scan.
const SWEEP_INTERVAL_MS = 60_000;

// A limiter that stalls the request while the database is unwell is worse than
// no limiter: Prisma's 5s default would spend half a Function's budget before
// the in-memory fallback below ever ran.
const TX_TIMEOUT_MS = 2_000;

interface BucketRow {
  key: string;
  tokens: number;
  updated_at: Date;
  /** The database clock, read inside the same transaction — see `consume`. */
  now: Date;
}

export class PostgresRateLimiter {
  private readonly refillPerMs: number;
  private readonly fallback: RateLimiter;
  private lastSweep = 0;

  constructor(private readonly opts: RateLimitOptions) {
    this.refillPerMs = opts.max / opts.windowMs;
    this.fallback = new RateLimiter(opts);
  }

  /**
   * Consume one token from every key, all-or-nothing — the same contract as
   * RateLimiter.tryConsume, held across processes rather than within one.
   */
  async tryConsume(keys: string | string[]): Promise<boolean> {
    const list = typeof keys === 'string' ? [keys] : keys;
    if (list.length === 0) return true;

    try {
      const allowed = await prisma.$transaction((tx) => this.consume(tx, list), {
        timeout: TX_TIMEOUT_MS,
        maxWait: TX_TIMEOUT_MS,
      });
      await this.sweep();
      return allowed;
    } catch (err) {
      // Loud, not silent: an outage here quietly downgrades a security control,
      // which is exactly the kind of thing that goes unnoticed for months.
      // Sentry aggregates, so a sustained outage is one issue rather than a
      // flood; console.error covers the deployments with no DSN set.
      //
      // ponytail: the fallback is per-instance, so while the database is
      // unreachable the ceiling is `max` per Function instance rather than
      // `max` overall — a caller who lands on N cold starts gets N budgets.
      // That is the honest price of not taking the API down for a database
      // wobble, and it lasts only as long as the wobble. Revisit only if
      // outages stop being rare enough for that to matter.
      console.error('Rate limiter fell back to in-memory buckets:', err);
      Sentry.captureException(err);
      return this.fallback.tryConsume(list);
    }
  }

  /**
   * The critical section. Two statements inside one transaction: take a row
   * lock on every key, then debit them together or not at all.
   *
   * Timestamps come from the database clock (`now()`, fixed for the whole
   * transaction), never from this process. Buckets are shared across Function
   * instances whose clocks drift independently, and a bucket stamped by a fast
   * clock reads as "in the future" to a slow one — one clock for everyone
   * removes the question.
   */
  private async consume(tx: Prisma.TransactionClient, keys: string[]): Promise<boolean> {
    // Sorted, and inserted in that order, so any two requests sharing keys
    // acquire them in the same sequence. Unsorted, a request holding
    // forgot:ip:X while waiting for forgot:email:Y deadlocks against one
    // holding Y and waiting for X. Deduplicated because ON CONFLICT DO UPDATE
    // refuses to touch the same row twice in one statement.
    const sorted = [...new Set(keys)].sort();
    const keyRows = Prisma.join(sorted.map((key) => Prisma.sql`(${key}::text)`));

    // Materialise-and-lock in one statement. A plain SELECT ... FOR UPDATE
    // cannot lock a row that does not exist yet, so two invocations racing on a
    // key's FIRST use would both read "no row", both treat it as a full bucket,
    // and both be granted. INSERT ... ON CONFLICT DO UPDATE has no such gap:
    // the loser blocks on the winner's tuple and its DO UPDATE then re-reads
    // the winner's committed row, so a key's first two requests are serialised
    // exactly like any later pair. Setting tokens to itself is a no-op write
    // whose only purpose is to take that lock.
    const rows = await tx.$queryRaw<BucketRow[]>`
      INSERT INTO "rate_limit_buckets" ("key", "tokens", "updated_at", "full_at")
      SELECT k.key, ${this.opts.max}::double precision, now(), now()
      FROM (VALUES ${keyRows}) AS k(key)
      ORDER BY k.key
      ON CONFLICT ("key") DO UPDATE SET "tokens" = "rate_limit_buckets"."tokens"
      RETURNING "key", "tokens", "updated_at", now() AS "now"`;

    const now = rows[0].now.getTime();
    const debited = rows.map((row) => ({
      key: row.key,
      bucket: refill(
        { tokens: row.tokens, last: row.updated_at.getTime() },
        now,
        this.opts.max,
        this.refillPerMs,
      ),
    }));

    // Rejected requests write nothing at all. Safe because refill is
    // idempotent: recomputing from the untouched (tokens, updated_at) at any
    // later instant gives the identical count. It also keeps a flood of
    // rejected requests from writing a row version each.
    if (!allowsAll(debited.map((entry) => entry.bucket))) return false;

    const updates = debited.map(({ key, bucket }) => {
      const spent = { tokens: bucket.tokens - 1, last: now };
      const secondsToFull = (fullAt(spent, this.opts.max, this.refillPerMs) - now) / 1000;
      return Prisma.sql`(${key}::text, ${spent.tokens}::double precision, ${secondsToFull}::double precision)`;
    });

    // Still holding the locks from the statement above, so nothing can slip a
    // debit in between the decision and the write.
    await tx.$executeRaw`
      UPDATE "rate_limit_buckets" AS b
      SET "tokens" = v.tokens,
          "updated_at" = now(),
          "full_at" = now() + interval '1 second' * v.seconds_to_full
      FROM (VALUES ${Prisma.join(updates)}) AS v(key, tokens, seconds_to_full)
      WHERE b."key" = v.key`;

    return true;
  }

  /**
   * Drop buckets that have refilled to capacity, so the table cannot grow
   * without bound. Safe for exactly the reason the in-memory sweep is safe: a
   * full bucket is indistinguishable from one that never existed, so dropping
   * it grants nobody anything — `full_at` is the instant that becomes true.
   *
   * SKIP LOCKED so the sweep never waits on a request in flight and therefore
   * can never deadlock with one; anything it skips is still full a minute
   * later. Failures are reported and swallowed: a sweep is housekeeping, and
   * refusing the request because the housekeeping failed helps nobody.
   */
  private async sweep(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSweep < SWEEP_INTERVAL_MS) return;
    this.lastSweep = now;

    try {
      await prisma.$executeRaw`
        DELETE FROM "rate_limit_buckets"
        WHERE "key" IN (
          SELECT "key" FROM "rate_limit_buckets"
          WHERE "full_at" <= now()
          FOR UPDATE SKIP LOCKED
        )`;
    } catch (err) {
      console.error('Rate limiter bucket sweep failed:', err);
      Sentry.captureException(err);
    }
  }
}
