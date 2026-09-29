import type { Request } from 'express';

/**
 * A client-minted duplicate-send key: a string, trimmed, 1–128 characters, or
 * null. Chat messages send it in the Idempotency-Key header; the offline event
 * batch sends one per item in the body (6.2).
 */
export function normalizeIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim();
  // Postgres refuses NUL in text; letting one through would 500 a whole batch.
  return key.length > 0 && key.length <= 128 && !key.includes('\0') ? key : null;
}

/** Optional duplicate-send protection: sanitized Idempotency-Key header or null. */
export function idempotencyKey(req: Request): string | null {
  return normalizeIdempotencyKey(req.get('Idempotency-Key'));
}
