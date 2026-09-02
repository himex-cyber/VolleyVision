// Express glue for the token-bucket limiters in lib/ (in-memory rateLimit.ts,
// shared postgresRateLimit.ts), plus the limiter instances the routes mount.
// Each instance owns its own buckets, so hammering one endpoint never spends
// another's budget.

import { Request, RequestHandler } from 'express';
import { PostgresRateLimiter } from '../lib/postgresRateLimit';
import { RateLimiter, RateLimitOptions } from '../lib/rateLimit';
import { AppError } from './errorHandler';

export interface RateLimitConfig {
  /** Time for an emptied bucket to refill completely. */
  windowMs: number;
  /** Burst capacity, and the sustained allowance per window. */
  max: number;
  /**
   * Dimensions this request is limited on. Return several keys to limit on all
   * of them at once (all must have capacity); return null or [] to skip the
   * limiter entirely for this request.
   */
  keyFn: (req: Request) => string | string[] | null;
  /** User-facing 429 message. */
  message: string;
}

/**
 * Production is one Netlify Function per invocation, so an in-memory bucket map
 * is a fresh empty map on every cold start and is never shared between
 * concurrent invocations — the limit would exist without ever limiting
 * anything. Everywhere else (local dev, `npm test`) is one long-lived process
 * where the in-memory limiter is both correct and free of a round trip.
 */
function makeLimiter(opts: RateLimitOptions): RateLimiter | PostgresRateLimiter {
  return process.env.NODE_ENV === 'production'
    ? new PostgresRateLimiter(opts)
    : new RateLimiter(opts);
}

export function createRateLimit(config: RateLimitConfig): RequestHandler {
  const limiter = makeLimiter({ windowMs: config.windowMs, max: config.max });
  return (req, _res, next) => {
    const keys = config.keyFn(req);
    if (!keys || keys.length === 0) { next(); return; }
    // The shared limiter is async, the in-memory one is not; Promise.resolve
    // covers both. The rejection arm is belt and braces — PostgresRateLimiter
    // already falls back rather than throwing — but an unhandled rejection
    // would take the whole process down instead of one request.
    Promise.resolve(limiter.tryConsume(keys)).then(
      (allowed) => {
        if (allowed) next();
        else next(new AppError(429, config.message));
      },
      next,
    );
  };
}

/**
 * Client IP for keying, best effort.
 *
 * Netlify sets x-nf-client-connection-ip to the connecting address, so prefer
 * it. Falling back to x-forwarded-for, take the RIGHT-most entry, not the
 * left-most: proxies append as the request travels, so the left-most value is
 * whatever the caller wrote and the right-most is what the nearest proxy
 * observed. Reading the left-most made this key fully caller-chosen.
 *
 * ponytail: we cannot prove the platform overwrites either header rather than
 * passing a forged one through, so treat the IP arm as best-effort. Two things
 * make that acceptable: every limiter below pairs it with a key the caller
 * can't forge (their email, or their authenticated user id), and RateLimiter
 * caps its key count, so a forged-IP flood can't grow the map without bound.
 * Enable Express `trust proxy` with a known hop count if the IP arm ever needs
 * to stand on its own.
 */
function clientIp(req: Request): string {
  const nf = req.headers['x-nf-client-connection-ip'];
  const direct = Array.isArray(nf) ? nf[0] : nf;
  if (direct) return direct.trim();

  const forwarded = req.headers['x-forwarded-for'];
  const chain = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  const nearest = chain?.split(',').pop();
  return (nearest ?? req.ip ?? 'unknown').trim();
}

// ─── Instances ────────────────────────────────────────────────────────────────

/**
 * Team Chat + the feedback submit form — per-user bucket so a runaway client
 * (or a held-down Enter key) can't flood a channel. 10 burst, ~2/second
 * sustained: `max / windowMs` = 10/5000ms, the original hand-rolled numbers.
 */
export const chatPostRateLimit = createRateLimit({
  windowMs: 5_000,
  max: 10,
  // Prefixed like every other limiter: the Postgres table is one shared key
  // space, so a bare id would let a future limiter keying on the same id
  // silently share this bucket.
  keyFn: (req) => (req.user?.userId ? `chat:user:${req.user.userId}` : null), // requireAuth handles the 401
  message: "You're sending messages too quickly — wait a moment and try again.",
});

/**
 * Forgot-password — unauthenticated and it sends mail, so it's both an
 * email-bombing vector and the natural place to hammer for account enumeration.
 *
 * Three arms. Per-email stops one address being flooded. Per-IP raises the cost
 * of hammering from one source. Neither bounds TOTAL outbound mail, because a
 * caller who rotates both the address and a forged IP header gets a fresh
 * bucket every time — so a global arm caps how much reset mail this deployment
 * will send in a window, whatever the caller varies.
 *
 * ponytail: the global arm is a blunt instrument — once tripped, legitimate
 * resets queue behind the abuse. 60 per 15 minutes sits far above real volume
 * for a club-sized user base and far below a useful mail bomb. Make it
 * per-tenant if that stops being true.
 */
export const forgotPasswordRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyFn: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const keys = [`forgot:ip:${clientIp(req)}`];
    if (email) keys.push(`forgot:email:${email}`);
    return keys;
  },
  message: 'Too many password reset requests. Wait a few minutes and try again.',
});

/**
 * The global cap on outbound reset mail, mounted alongside the per-IP/per-email
 * limiter above. Separate instance because it needs its own budget: a single
 * fixed key in the same bucket map would be drained by the same `max` as an
 * individual caller.
 */
export const forgotPasswordGlobalRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyFn: () => 'forgot:global',
  message: 'Too many password reset requests right now. Try again shortly.',
});

/**
 * Join-code lookup and redemption — defence in depth only. A code is 8 chars
 * from a 32-symbol alphabet (~1.1e12 combinations), so guessing is already
 * hopeless; this just makes automated sweeps pointless. Deliberately roomier
 * than the forgot-password budget because legitimate use costs several calls
 * (look the code up, mistype it, redeem it).
 */
export const joinCodeRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyFn: (req) => [`code:ip:${clientIp(req)}`, `code:user:${req.user?.userId ?? 'anon'}`],
  message: 'Too many join code attempts. Wait a few minutes and try again.',
});
