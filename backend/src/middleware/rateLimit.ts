// Express glue for the token-bucket limiter in lib/rateLimit.ts, plus the
// limiter instances the routes mount. Each instance owns its own bucket map, so
// hammering one endpoint never spends another's budget.

import { Request, RequestHandler } from 'express';
import { RateLimiter } from '../lib/rateLimit';
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

export function createRateLimit(config: RateLimitConfig): RequestHandler {
  const limiter = new RateLimiter({ windowMs: config.windowMs, max: config.max });
  return (req, _res, next) => {
    const keys = config.keyFn(req);
    if (!keys || keys.length === 0) { next(); return; }
    if (!limiter.tryConsume(keys)) { next(new AppError(429, config.message)); return; }
    next();
  };
}

/**
 * Client IP for keying. Netlify sets x-forwarded-for; Express's req.ip is the
 * socket peer, which behind the platform proxy is the same for everyone.
 *
 * ponytail: x-forwarded-for is spoofable because Express `trust proxy` is not
 * enabled, so this arm alone is weak — every limiter below pairs it with a key
 * the caller can't forge (their email, or their authenticated user id). Enable
 * trust proxy if the IP arm ever needs to stand on its own.
 */
function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first ?? req.ip ?? 'unknown').trim();
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
  keyFn: (req) => req.user?.userId ?? null, // requireAuth handles the 401
  message: "You're sending messages too quickly — wait a moment and try again.",
});

/**
 * Forgot-password — unauthenticated and it sends mail, so it's both an
 * email-bombing vector and the natural place to hammer for account enumeration.
 * Keyed on IP *and* the normalized email so neither rotating the address nor
 * (where the platform header is trustworthy) rotating the source buys more
 * attempts. Tokens trickle back continuously — one every 3 minutes — rather
 * than the caller being hard-blocked for the full window.
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
