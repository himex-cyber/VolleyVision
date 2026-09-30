import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapErrorToResponse } from './mapError';
import { AppError } from '../middleware/errorHandler';

describe('mapErrorToResponse', () => {
  it('maps a statusCode-carrying error, message shown for 4xx', () => {
    const err = Object.assign(new Error('Invitation not found'), { statusCode: 404 });
    assert.deepEqual(mapErrorToResponse(err), { status: 404, body: { error: 'Invitation not found' } });
  });

  it('keeps an optional code alongside a statusCode error (e.g. EMAIL_NOT_VERIFIED)', () => {
    const err = Object.assign(new Error('Email not verified'), { statusCode: 403, code: 'EMAIL_NOT_VERIFIED' });
    assert.deepEqual(mapErrorToResponse(err), {
      status: 403,
      body: { error: 'Email not verified', code: 'EMAIL_NOT_VERIFIED' },
    });
  });

  it('marks a serialization conflict as retryable (6.5), and nothing else', () => {
    const conflict = new AppError(409, 'Someone else changed this at the same moment. Please try again.', 'SERIALIZATION_CONFLICT');
    assert.deepEqual(mapErrorToResponse(conflict), {
      status: 409,
      body: { error: 'Someone else changed this at the same moment. Please try again.', code: 'SERIALIZATION_CONFLICT', retryable: true },
    });
    const other = new AppError(409, 'This player record is already linked to someone. Unlink it first.');
    assert.equal('retryable' in mapErrorToResponse(other).body, false);
    const coded = new AppError(403, 'Verify your email.', 'EMAIL_NOT_VERIFIED');
    assert.equal('retryable' in mapErrorToResponse(coded).body, false);
  });

  it('maps Prisma P2002 to a generic 409', () => {
    const err = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    assert.deepEqual(mapErrorToResponse(err), {
      status: 409,
      body: { error: 'A record with those details already exists.' },
    });
  });

  it('maps Prisma P2025 to a generic 404', () => {
    const err = Object.assign(new Error('Record not found'), { code: 'P2025' });
    assert.deepEqual(mapErrorToResponse(err), { status: 404, body: { error: 'Record not found.' } });
  });

  it('maps Prisma P2003 (a foreign key refused the write) to 409 (9.4)', () => {
    // e.g. a message sent while its author's account is being deleted.
    const err = Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' });
    assert.deepEqual(mapErrorToResponse(err), {
      status: 409, body: { error: 'This changed while you were working. Refresh and try again.' },
    });
  });

  it("passes an AppError's details through, next to code (9.4)", () => {
    const err = Object.assign(new Error('Transfer or delete these teams first: A.'), {
      statusCode: 409, code: 'ACCOUNT_HAS_TEAMS', details: { teams: [{ id: 't1', name: 'A', reason: 'owner' }] },
    });
    assert.deepEqual(mapErrorToResponse(err).body, {
      error: 'Transfer or delete these teams first: A.', code: 'ACCOUNT_HAS_TEAMS', teams: [{ id: 't1', name: 'A', reason: 'owner' }],
    });
  });

  it('hides the real message for an unrecognized error, returning a generic 500', () => {
    const err = new Error('some internal detail that should not leak');
    assert.deepEqual(mapErrorToResponse(err), { status: 500, body: { error: 'An unexpected error occurred.' } });
  });
});
