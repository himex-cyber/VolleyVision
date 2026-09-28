// Roadmap defect 5: approving read the request, applied it, then marked it
// APPROVED. Two approvers clicking at once both read PENDING and both applied
// it - PLAYER_CREATE twice made two players. The request is now claimed with
// one conditional update before anything is applied; the loser gets 409.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { approveRequest, rejectRequest } from '../services/approval.service';

const REQUEST = { id: 'r1', teamId: 't1', requestedById: 'asst', action: 'PLAYER_DELETE', payload: {}, targetId: 'p1', status: 'PENDING' };

// One pending request on a team "owner" owns; the row's status is real state,
// so a conditional updateMany behaves like Postgres's.
function world() {
  resetDb();
  let status = 'PENDING';
  db.user.findUnique = async () => ({ role: 'COACH' });
  db.team.findUnique = async () => ({ ownerId: 'owner' });
  db.teamMembership.findUnique = async () => null;
  db.approvalRequest.findUnique = async () => ({ ...REQUEST, status });
  db.approvalRequest.findUniqueOrThrow = async () => ({ ...REQUEST, status });
  db.approvalRequest.updateMany = async (args: any) => {
    if (args.where.status !== status) return { count: 0 };
    status = args.data.status;
    return { count: 1 };
  };
  db.approvalRequest.update = async (args: any) => { status = args.data.status; return { ...REQUEST, status }; };
  db.player.delete = async () => ({ id: 'p1' });
  return { statusNow: () => status };
}

async function statusOf(p: Promise<unknown>): Promise<number | 'ok'> {
  try { await p; return 'ok'; } catch (err: any) { return err.statusCode; }
}

async function concurrentApprovesApplyOnce() {
  const w = world();
  const results = await Promise.all([statusOf(approveRequest('r1', 'owner')), statusOf(approveRequest('r1', 'owner'))]);
  assert.deepEqual([...results].sort(), [409, 'ok'].sort(), 'exactly one approve wins; the other gets 409');
  assert.equal(callsFor('player', 'delete').length, 1, 'the change must be applied once');
  assert.equal(w.statusNow(), 'APPROVED');
}

async function failedApplyLeavesRequestPending() {
  const w = world();
  db.player.delete = async () => { throw new Error('target already gone'); };
  assert.notEqual(await statusOf(approveRequest('r1', 'owner')), 'ok');
  assert.equal(w.statusNow(), 'PENDING', 'a failed apply must hand the request back');
  const revert = callsFor('approvalRequest', 'update').at(-1)?.[0];
  assert.equal(revert?.data.resolvedById, null);
  assert.equal(revert?.data.resolvedAt, null);
}

async function approveAfterRejectIs409() {
  world();
  assert.equal(await statusOf(rejectRequest('r1', 'owner')), 'ok');
  assert.equal(await statusOf(approveRequest('r1', 'owner')), 409);
  assert.equal(callsFor('player', 'delete').length, 0);
}

async function outsiderGets404NotTheStatus() {
  world();
  // Not the owner, no membership, not an admin: the request's team is invisible.
  assert.equal(await statusOf(approveRequest('r1', 'stranger')), 404);
  assert.equal(callsFor('approvalRequest', 'updateMany').length, 0);
}

async function main() {
  await concurrentApprovesApplyOnce();
  await failedApplyLeavesRequestPending();
  await approveAfterRejectIs409();
  await outsiderGets404NotTheStatus();
  console.log('approvalAtomic.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
