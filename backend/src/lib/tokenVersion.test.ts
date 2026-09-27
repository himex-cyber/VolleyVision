import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTokenCurrent } from './tokenVersion';

describe('isTokenCurrent', () => {
  it('matches when the claim equals the current version', () => {
    assert.equal(isTokenCurrent(0, 0), true);
    assert.equal(isTokenCurrent(3, 3), true);
  });

  it('rejects a stale claim', () => {
    assert.equal(isTokenCurrent(0, 1), false);
    assert.equal(isTokenCurrent(2, 3), false);
  });

  it('treats a missing/non-numeric claim as tv 0, for pre-deploy tokens', () => {
    assert.equal(isTokenCurrent(undefined, 0), true);
    assert.equal(isTokenCurrent(undefined, 1), false);
    assert.equal(isTokenCurrent('3', 0), true); // not a number → treated as 0
    assert.equal(isTokenCurrent(null, 0), true);
  });
});
