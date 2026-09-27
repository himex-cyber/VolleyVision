import { randomUUID, randomInt } from 'crypto';

// Human-enterable join code: 8 chars, unambiguous alphabet (no 0/O/1/I).
// Shared by per-email invitation codes and the reusable team join codes so
// every code a user sees looks and behaves identically.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Code length as generated. The UUID fallback below is deliberately longer. */
export const CODE_LENGTH = 8;

/** Attempts before giving up on the unambiguous alphabet and falling back. */
export const MAX_GENERATION_ATTEMPTS = 10;

/**
 * Codes are stored uppercase, so every lookup must normalize the same way —
 * users paste them with stray whitespace and type them in lower case. Shared by
 * every redeem/lookup path so the three of them can't drift apart.
 */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Generate a unique join code. `exists` answers "is this code already taken?"
 * for whatever namespace the caller draws from (invitations, team player
 * codes, team staff codes).
 */
export async function generateUniqueCode(exists: (code: string) => Promise<boolean>): Promise<string> {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!(await exists(code))) return code;
  }
  // Extremely unlikely; fall back to a UUID-derived code.
  return randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
}
