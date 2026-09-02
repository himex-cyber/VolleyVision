import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeEmail } from './email';

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
