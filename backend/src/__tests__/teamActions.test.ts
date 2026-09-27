// applyCreateInvitation regression (Greptile fix): the inviter's CURRENT role
// is re-checked against canInviteRole every time this runs — including the
// queued-approval path, where the payload's inviter role can be stale by the
// time a head coach approves it — and HEAD_COACH is never an invitable role
// no matter who is asking.
import assert from 'node:assert/strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { applyCreateInvitation } from '../services/teamActions.service';

async function assertRejects(fn: () => Promise<unknown>, statusCode: number) {
  try {
    await fn();
  } catch (err: any) {
    assert.equal(err.statusCode, statusCode);
    return;
  }
  assert.fail('expected a rejection');
}

async function inviterWhoseCurrentRoleCanNoLongerInviteIsRejected() {
  resetDb();
  // Not the owner, and currently a STATISTICIAN — outranked by the
  // ASSISTANT_COACH role they're trying to hand out.
  db.team.findUnique = async () => ({ ownerId: 'someoneElse' });
  db.teamMembership.findUnique = async () => ({ role: 'STATISTICIAN' });

  await assertRejects(
    () => applyCreateInvitation({ teamId: 'team1', invitedById: 'u1', email: 'x@y.com', role: 'ASSISTANT_COACH' as any }),
    403,
  );
  assert.equal(callsFor('invitation', 'create').length, 0, 'no invitation may be created for a rejected invite');
}

async function headCoachIsNeverInvitableEvenByTheOwner() {
  resetDb();
  db.team.findUnique = async () => ({ ownerId: 'u1' }); // caller IS the owner -> resolves to HEAD_COACH
  db.teamMembership.findUnique = async () => null;

  await assertRejects(
    () => applyCreateInvitation({ teamId: 'team1', invitedById: 'u1', email: 'x@y.com', role: 'HEAD_COACH' as any }),
    403,
  );
  assert.equal(callsFor('invitation', 'create').length, 0);
}

async function main() {
  await inviterWhoseCurrentRoleCanNoLongerInviteIsRejected();
  await headCoachIsNeverInvitableEvenByTheOwner();
  console.log('teamActions.test.ts passed');
}

main();
