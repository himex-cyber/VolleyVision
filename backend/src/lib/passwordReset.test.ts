import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import {
  CONSUMED_RESET_FIELDS,
  RESET_TOKEN_BYTES,
  RESET_TOKEN_TTL_MS,
  hashResetToken,
  resetTokenExpiry,
  usableResetTokenWhere,
} from './passwordReset';

// ─── Token hashing ────────────────────────────────────────────────────────────

describe('hashResetToken', () => {
  it('is SHA-256, hex encoded', () => {
    // Pinned against an independent computation — if the digest ever changes,
    // every live reset link silently stops working.
    const token = 'a'.repeat(64);
    const expected = crypto.createHash('sha256').update(token).digest('hex');
    assert.equal(hashResetToken(token), expected);
    assert.equal(hashResetToken(token).length, 64);
    assert.match(hashResetToken(token), /^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same token', () => {
    assert.equal(hashResetToken('same-token'), hashResetToken('same-token'));
  });

  it('never returns the raw token, and differs for a one-character change', () => {
    const token = 'abcdef0123456789';
    assert.notEqual(hashResetToken(token), token);
    assert.notEqual(hashResetToken(token), hashResetToken('abcdef012345678a'));
  });

  it('mints 32 bytes of entropy — 64 hex characters', () => {
    assert.equal(RESET_TOKEN_BYTES, 32);
    assert.equal(crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex').length, 64);
  });
});

// ─── Expiry ───────────────────────────────────────────────────────────────────

describe('resetTokenExpiry', () => {
  it('is exactly one hour after the given instant', () => {
    assert.equal(RESET_TOKEN_TTL_MS, 60 * 60 * 1000);
    const now = new Date('2026-08-06T12:00:00.000Z');
    assert.equal(resetTokenExpiry(now).toISOString(), '2026-08-06T13:00:00.000Z');
  });

  it('does not mutate the instant it is handed', () => {
    const now = new Date('2026-08-06T12:00:00.000Z');
    resetTokenExpiry(now);
    assert.equal(now.toISOString(), '2026-08-06T12:00:00.000Z');
  });
});

// ─── Lookup predicate ─────────────────────────────────────────────────────────

describe('usableResetTokenWhere', () => {
  it('matches on the hash, never on the raw token', () => {
    const where = usableResetTokenWhere('plain-token');
    assert.equal(where.passwordResetTokenHash, hashResetToken('plain-token'));
    assert.notEqual(where.passwordResetTokenHash, 'plain-token');
  });

  it('requires the expiry to be strictly in the future', () => {
    const now = new Date('2026-08-06T12:00:00.000Z');
    const where = usableResetTokenWhere('t', now);
    assert.deepEqual(where.passwordResetExpiresAt, { gt: now });
  });

  it('a token minted now is still usable, one minted an hour ago is not', () => {
    const issuedAt = new Date('2026-08-06T12:00:00.000Z');
    const expiresAt = resetTokenExpiry(issuedAt);

    const justAfterIssue = usableResetTokenWhere('t', new Date(issuedAt.getTime() + 1000));
    assert.equal(expiresAt > justAfterIssue.passwordResetExpiresAt.gt, true);

    // One millisecond past the TTL the row no longer satisfies `gt`.
    const pastTtl = usableResetTokenWhere('t', new Date(expiresAt.getTime() + 1));
    assert.equal(expiresAt > pastTtl.passwordResetExpiresAt.gt, false);
  });
});

// ─── Single use ───────────────────────────────────────────────────────────────

describe('CONSUMED_RESET_FIELDS', () => {
  it('clears both reset columns so the link cannot be replayed', () => {
    assert.deepEqual({ ...CONSUMED_RESET_FIELDS }, {
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    });
  });

  it('a consumed row matches no lookup, whatever token is presented', () => {
    const consumed = { ...CONSUMED_RESET_FIELDS };
    const where = usableResetTokenWhere('any-token');
    // The stored hash is null; the predicate always looks for a 64-char digest,
    // so there is nothing left for a replay to match against.
    assert.equal(consumed.passwordResetTokenHash, null);
    assert.notEqual(where.passwordResetTokenHash, consumed.passwordResetTokenHash);
  });
});
