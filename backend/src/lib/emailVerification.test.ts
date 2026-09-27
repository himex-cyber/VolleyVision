import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONSUMED_EMAIL_VERIFICATION_FIELDS,
  EMAIL_VERIFICATION_TTL_MS,
  emailVerificationExpiry,
  hashEmailVerificationToken,
  usableEmailVerificationWhere,
} from './emailVerification';

describe('emailVerificationExpiry', () => {
  it('is exactly 24 hours after the given instant', () => {
    assert.equal(EMAIL_VERIFICATION_TTL_MS, 24 * 60 * 60 * 1000);
    const now = new Date('2026-08-06T12:00:00.000Z');
    assert.equal(emailVerificationExpiry(now).toISOString(), '2026-08-07T12:00:00.000Z');
  });
});

describe('usableEmailVerificationWhere', () => {
  it('matches on the hash, never on the raw token', () => {
    const where = usableEmailVerificationWhere('plain-token');
    assert.equal(where.emailVerificationTokenHash, hashEmailVerificationToken('plain-token'));
    assert.notEqual(where.emailVerificationTokenHash, 'plain-token');
  });

  it('a token minted now is usable, one minted 24h+1ms ago is not', () => {
    const issuedAt = new Date('2026-08-06T12:00:00.000Z');
    const expiresAt = emailVerificationExpiry(issuedAt);

    const justAfterIssue = usableEmailVerificationWhere('t', new Date(issuedAt.getTime() + 1000));
    assert.equal(expiresAt > justAfterIssue.emailVerificationExpiresAt.gt, true);

    const pastTtl = usableEmailVerificationWhere('t', new Date(expiresAt.getTime() + 1));
    assert.equal(expiresAt > pastTtl.emailVerificationExpiresAt.gt, false);
  });
});

describe('CONSUMED_EMAIL_VERIFICATION_FIELDS', () => {
  it('clears both verification columns so the link cannot be replayed', () => {
    assert.deepEqual({ ...CONSUMED_EMAIL_VERIFICATION_FIELDS }, {
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
    });
  });
});
