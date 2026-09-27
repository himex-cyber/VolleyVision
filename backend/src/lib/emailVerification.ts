// Email-verification token rules — the pure parts of the flow, mirroring
// lib/passwordReset.ts exactly (32 random bytes handed to the user, only the
// SHA-256 stored, single use). Only the TTL differs: 24 hours rather than 1,
// because this link can sit in an inbox much longer before anyone acts on it.

import { hashResetToken } from './passwordReset';

/** Entropy of the token mailed to the user — same as the reset token. */
export const EMAIL_VERIFICATION_TOKEN_BYTES = 32;

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Same sha256 scheme as password reset — a DB leak can't be replayed either way. */
export const hashEmailVerificationToken = hashResetToken;

/** Absolute expiry for a token minted at `now`. */
export function emailVerificationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS);
}

/**
 * WHERE fragment matching the one live token for `token`: the stored hash must
 * match AND the expiry must still be in the future, compared in the database
 * so a row that lapsed mid-request can't slip through.
 */
export function usableEmailVerificationWhere(token: string, now: Date = new Date()) {
  return {
    emailVerificationTokenHash: hashEmailVerificationToken(token),
    emailVerificationExpiresAt: { gt: now },
  };
}

/**
 * Single-use invalidation: both columns go null the moment a token is spent.
 * Minting a new one (resend) overwrites the stored hash, invalidating any
 * previous link — there is at most one live verification token per user.
 */
export const CONSUMED_EMAIL_VERIFICATION_FIELDS = {
  emailVerificationTokenHash: null,
  emailVerificationExpiresAt: null,
} as const;
