// Password-reset token rules — the pure parts of the flow, split out of
// auth.service.ts so they can be unit-tested without a database
// (`npm test` only runs src/lib/*.test.ts).
//
// The scheme is unchanged and deliberately boring: 32 random bytes handed to
// the user, only the SHA-256 of that token stored, single use, one hour to live.

import crypto from 'crypto';

/** Entropy of the token mailed to the user. */
export const RESET_TOKEN_BYTES = 32;

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Only the hash is ever stored, so a DB leak can't be replayed as a reset link. */
export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Absolute expiry for a token minted at `now`. */
export function resetTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MS);
}

/**
 * WHERE fragment matching the one live token for `token`: the stored hash must
 * match AND the expiry must still be in the future. Expiry is compared in the
 * database rather than in memory so a row that lapsed mid-request can't slip
 * through.
 */
export function usableResetTokenWhere(token: string, now: Date = new Date()) {
  return {
    passwordResetTokenHash: hashResetToken(token),
    passwordResetExpiresAt: { gt: now },
  };
}

/**
 * Single-use invalidation: both columns go null the moment a token is spent, so
 * the same link can't be replayed. Requesting a new link overwrites the stored
 * hash, which invalidates any previous one the same way — there is at most one
 * live reset token per user.
 */
export const CONSUMED_RESET_FIELDS = {
  passwordResetTokenHash: null,
  passwordResetExpiresAt: null,
} as const;
