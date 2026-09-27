// Coach-rule regression (Phase 2): exactly one HEAD_COACH per team, at most
// two ASSISTANT_COACH. addMember and updateMemberRole are the only two writers
// of TeamMembership.role, and both go through lib/roleSlots.roleSlotError
// inside withRoleSlot's SERIALIZABLE transaction.
import assert from 'node:assert/strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { addMember, updateMemberRole, removeMember } from '../services/teamMembership.service';

async function assertRejects(fn: () => Promise<unknown>, statusCode: number, messageMatch?: RegExp) {
  try {
    await fn();
  } catch (err: any) {
    assert.equal(err.statusCode, statusCode);
    if (messageMatch) assert.match(err.message, messageMatch);
    return;
  }
  assert.fail('expected a rejection');
}

async function addMemberRefusesHeadCoach() {
  resetDb();
  db.team.findUnique = async () => ({ id: 'team1' });
  db.user.findUnique = async () => ({ id: 'u1' });
  db.teamMembership.findUnique = async () => null; // not already a member
  await assertRejects(() => addMember('team1', 'u1', 'HEAD_COACH' as any), 409, /transfer ownership/i);
  assert.equal(callsFor('teamMembership', 'create').length, 0);
}

async function addMemberRefusesThirdAssistant() {
  resetDb();
  db.team.findUnique = async () => ({ id: 'team1' });
  db.user.findUnique = async () => ({ id: 'u1' });
  db.teamMembership.findUnique = async () => null;
  db.teamMembership.count = async () => 2; // two assistants already
  await assertRejects(() => addMember('team1', 'u1', 'ASSISTANT_COACH' as any), 409, /at most 2/);
  assert.equal(callsFor('teamMembership', 'create').length, 0);
}

async function updateMemberRoleSameRoleIsNoOp() {
  resetDb();
  db.teamMembership.findFirst = async () => ({ id: 'm1', teamId: 'team1', userId: 'u1', role: 'PLAYER' });
  db.teamMembership.findUniqueOrThrow = async () => ({ id: 'm1', role: 'PLAYER' });
  const result = await updateMemberRole('team1', 'm1', 'PLAYER' as any);
  assert.equal((result as any).role, 'PLAYER');
  assert.equal(callsFor('teamMembership', 'update').length, 0, 're-saving the same role must not write');
  assert.equal(callsFor('teamMembership', 'count').length, 0, 'must not even enter the role-slot transaction');
}

async function updateMemberRoleCannotDemoteHeadCoach() {
  resetDb();
  db.teamMembership.findFirst = async () => ({ id: 'm1', teamId: 'team1', userId: 'u1', role: 'HEAD_COACH' });
  await assertRejects(() => updateMemberRole('team1', 'm1', 'MANAGER' as any), 409, /team owner/i);
  assert.equal(callsFor('teamMembership', 'update').length, 0);
}

async function removeMemberCannotRemoveHeadCoach() {
  resetDb();
  db.teamMembership.findFirst = async () => ({ id: 'm1', teamId: 'team1', userId: 'u1', role: 'HEAD_COACH' });
  db.teamMembership.findUniqueOrThrow = async () => ({ role: 'HEAD_COACH' });
  await assertRejects(() => removeMember('team1', 'm1'), 409, /transfer ownership/i);
  assert.equal(callsFor('teamMembership', 'delete').length, 0);
}

async function main() {
  await addMemberRefusesHeadCoach();
  await addMemberRefusesThirdAssistant();
  await updateMemberRoleSameRoleIsNoOp();
  await updateMemberRoleCannotDemoteHeadCoach();
  await removeMemberCannotRemoveHeadCoach();
  console.log('roleLimits.test.ts passed');
}

main();
