// 9.4: what stops an account being deleted, and what the person is told.
import assert from 'node:assert/strict';
import { deletionBlockers, blockersMessage, DELETED_USER_ID } from './accountDeletion';

const A = { id: 't1', name: 'Falcons' };
const B = { id: 't2', name: 'Wolves' };

assert.deepEqual(deletionBlockers([], []), [], 'no teams: nothing in the way');
assert.deepEqual(deletionBlockers([A], []), [{ ...A, reason: 'owner' }]);
assert.deepEqual(deletionBlockers([], [B]), [{ ...B, reason: 'head_coach' }], 'head coach of a team they do not own (legacy data)');
assert.deepEqual(deletionBlockers([A], [A, B]), [{ ...A, reason: 'owner' }, { ...B, reason: 'head_coach' }], 'an owner who is also its head coach is listed once');

assert.equal(blockersMessage([{ ...A, reason: 'owner' }, { id: 't3', name: 'Hawks', reason: 'owner' }]),
  'Transfer or delete these teams first: Falcons, Hawks.');
assert.equal(blockersMessage([{ ...B, reason: 'head_coach' }]),
  "You're the head coach of Wolves. Ask its owner to change your role, or contact support.");
assert.equal(blockersMessage([{ ...A, reason: 'owner' }, { ...B, reason: 'head_coach' }]),
  "Transfer or delete these teams first: Falcons. You're the head coach of Wolves. Ask its owner to change your role, or contact support.");

assert.equal(DELETED_USER_ID, 'deleted-user', 'the audit stand-in (Karlos, 1 Oct)');

console.log('accountDeletion.test.ts passed');
