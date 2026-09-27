import assert from 'node:assert/strict';
import { roleSlotError, MAX_ASSISTANT_COACHES } from './roleSlots';

assert.ok(roleSlotError('HEAD_COACH', 0), 'HEAD_COACH is never assignable');
assert.equal(roleSlotError('ASSISTANT_COACH', 0), null);
assert.equal(roleSlotError('ASSISTANT_COACH', MAX_ASSISTANT_COACHES - 1), null, 'the last slot is still free');
assert.ok(roleSlotError('ASSISTANT_COACH', MAX_ASSISTANT_COACHES), 'a third assistant is refused');
for (const role of ['MANAGER', 'STATISTICIAN', 'PLAYER', 'VIEWER']) {
  assert.equal(roleSlotError(role, 99), null, `${role} is unlimited`);
}

console.log('Role slot tests passed.');
