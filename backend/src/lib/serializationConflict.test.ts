import assert from 'node:assert/strict';
import { isSerializationConflict } from './serializationConflict';

assert.equal(isSerializationConflict({ code: 'P2034' }), true);
assert.equal(isSerializationConflict({ code: 'P2002' }), false, 'a unique violation is not a race to retry');
assert.equal(isSerializationConflict(new Error('boom')), false);
assert.equal(isSerializationConflict(null), false);
assert.equal(isSerializationConflict(undefined), false);

console.log('Serialization conflict tests passed.');
