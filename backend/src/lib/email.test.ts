import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeEmail, isEmailAddress } from './email';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    assert.equal(normalizeEmail('  Karlos@Example.COM  '), 'karlos@example.com');
  });

  it('is idempotent - normalising twice is the same as once', () => {
    const once = normalizeEmail(' A@B.com ');
    assert.equal(normalizeEmail(once), once);
  });

  // The bug this module exists to close: a padded address and its clean form
  // must resolve to the same value, or a row written by one code path becomes
  // unreachable to another.
  it('makes a padded address match its clean form', () => {
    assert.equal(normalizeEmail(' a@b.com'), normalizeEmail('a@b.com'));
    assert.equal(normalizeEmail('a@b.com '), normalizeEmail('A@B.COM'));
  });

  it('leaves an already-clean address untouched', () => {
    assert.equal(normalizeEmail('a@b.com'), 'a@b.com');
  });

  it('does not strip whitespace inside the address', () => {
    assert.equal(normalizeEmail('  a b@c.com  '), 'a b@c.com');
  });
});

describe('isEmailAddress', () => {
  // The regression this guard exists to prevent: the add-member lookup
  // accepting a fragment and substring-matching the user table with it. If
  // these ever start passing, the enumeration oracle is back.
  it('rejects the fragments that made enumeration cheap', () => {
    assert.equal(isEmailAddress('ka'), false);
    assert.equal(isEmailAddress('karlos'), false);
    assert.equal(isEmailAddress('@'), false);
    assert.equal(isEmailAddress('gmail.com'), false);
    assert.equal(isEmailAddress(''), false);
  });

  it('accepts a whole address', () => {
    assert.equal(isEmailAddress('karlos@example.com'), true);
    assert.equal(isEmailAddress('a.b+tag@sub.example.co.nz'), true);
  });

  it('accepts exactly what normalizeEmail produces from a padded address', () => {
    assert.equal(isEmailAddress(normalizeEmail('  Karlos@Example.COM  ')), true);
  });

  // normalizeEmail trims the ends but not the middle, so an address with an
  // interior space reaches the lookup intact - and must not be treated as one.
  it('rejects an address with interior whitespace', () => {
    assert.equal(isEmailAddress(normalizeEmail('  a b@c.com  ')), false);
  });

  it('rejects malformed shapes that would otherwise reach the query', () => {
    assert.equal(isEmailAddress('@example.com'), false);
    assert.equal(isEmailAddress('a@b'), false);
    assert.equal(isEmailAddress('a@b.'), false);
    assert.equal(isEmailAddress('a@.com'), false);
    assert.equal(isEmailAddress('a@b@c.com'), false);
  });
});
