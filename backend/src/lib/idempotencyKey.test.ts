import assert from 'node:assert/strict';
import { normalizeIdempotencyKey } from './idempotencyKey';

assert.equal(normalizeIdempotencyKey('abc'), 'abc');
assert.equal(normalizeIdempotencyKey('  abc  '), 'abc', 'trimmed');
assert.equal(normalizeIdempotencyKey('x'.repeat(128)), 'x'.repeat(128), '128 chars is the limit');
assert.equal(normalizeIdempotencyKey('x'.repeat(129)), null, 'too long');
assert.equal(normalizeIdempotencyKey('   '), null, 'blank');
assert.equal(normalizeIdempotencyKey(''), null);
assert.equal(normalizeIdempotencyKey(undefined), null);
assert.equal(normalizeIdempotencyKey(null), null);
assert.equal(normalizeIdempotencyKey(42), null, 'only strings');
assert.equal(normalizeIdempotencyKey(['a']), null);
assert.equal(normalizeIdempotencyKey('a\0b'), null, 'Postgres refuses NUL');

console.log('idempotencyKey.test.ts passed');
