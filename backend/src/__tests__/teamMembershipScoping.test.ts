// C1 regression: updateMemberRole / updateMemberAccess / removeMember must
// scope the membership lookup to BOTH the membership id AND the team id in
// the URL, so the owner of team A can't edit or remove a membership that
// belongs to team B. The where-clause itself IS the security property, so
// these assert its shape, not just the outcome.
import assert from 'node:assert/strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import {
  updateMemberRole,
  updateMemberAccess,
  removeMember,
  findTeamMembership,
} from '../services/teamMembership.service';

async function assertRejects(fn: () => Promise<unknown>, statusCode: number) {
  try {
    await fn();
  } catch (err: any) {
    assert.equal(err.statusCode, statusCode);
    return;
  }
  assert.fail('expected a rejection');
}

async function findTeamMembershipUsesIdAndTeamIdWhere() {
  resetDb();
  db.teamMembership.findFirst = async ({ where }: any) => {
    // The membership exists, but under a DIFFERENT team than the one asked
    // for — a real DB with this where clause would return null here.
    if (where.id === 'm1' && where.teamId === 'teamA') return null;
    return { id: 'm1', teamId: 'teamB', role: 'PLAYER', userId: 'u1' };
  };
  await assertRejects(() => findTeamMembership('teamA', 'm1'), 404);

  const [args] = callsFor('teamMembership', 'findFirst');
  assert.deepEqual(args[0].where, { id: 'm1', teamId: 'teamA' });
}

async function updateMemberRoleScopesToTeam() {
  resetDb();
  db.teamMembership.findFirst = async () => null; // wrong-team membership, as above
  await assertRejects(() => updateMemberRole('teamA', 'm1', 'MANAGER' as any), 404);
  assert.equal(callsFor('teamMembership', 'update').length, 0, 'must not write across teams');
}

async function updateMemberAccessScopesToTeam() {
  resetDb();
  db.teamMembership.findFirst = async () => null;
  await assertRejects(
    () => updateMemberAccess('teamA', 'm1', { rosterAccess: 'FULL_ACCESS' as any }),
    404,
  );
  assert.equal(callsFor('teamMembership', 'update').length, 0);
}

async function removeMemberScopesToTeam() {
  resetDb();
  db.teamMembership.findFirst = async () => null;
  await assertRejects(() => removeMember('teamA', 'm1'), 404);
  assert.equal(callsFor('teamMembership', 'delete').length, 0);
}

async function main() {
  await findTeamMembershipUsesIdAndTeamIdWhere();
  await updateMemberRoleScopesToTeam();
  await updateMemberAccessScopesToTeam();
  await removeMemberScopesToTeam();
  console.log('teamMembershipScoping.test.ts passed');
}

main();
