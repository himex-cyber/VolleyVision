// M8 regression: GET /teams/:id/members only returns emails to callers who
// hold MANAGE_MEMBERS — everyone else sees names and roles only. Players are
// often minors, so this is checked at the controller layer even though the
// route guard already gates the endpoint itself.
import assert from 'node:assert/strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

import { db, resetDb } from '../testing/installFakePrisma';
import { listMembers } from '../controllers/teamMembership';

const members = [
  { id: 'm1', role: 'PLAYER', joinedAt: new Date(), user: { id: 'u1', firstName: 'A', lastName: 'B', email: 'a@b.com' } },
];

function fakeRes() {
  const res: any = { body: null };
  res.json = (body: unknown) => { res.body = body; return res; };
  return res;
}

async function memberWithoutManageMembersGetsNoEmails() {
  resetDb();
  db.team.findUnique = async () => ({ id: 'team1', ownerId: 'ownerX' });
  db.teamMembership.findMany = async () => members;
  db.teamMembership.findUnique = async () => ({ role: 'PLAYER' }); // no MANAGE_MEMBERS

  const req: any = { params: { id: 'team1' }, user: { userId: 'viewer1' } };
  const res = fakeRes();
  let nextErr: unknown;
  await listMembers(req, res, (e?: unknown) => { nextErr = e; });

  assert.equal(nextErr, undefined);
  assert.equal(res.body[0].user.email, undefined, 'a non-manager must not see member emails');
}

async function managerGetsEmails() {
  resetDb();
  db.team.findUnique = async () => ({ id: 'team1', ownerId: 'ownerX' });
  db.teamMembership.findMany = async () => members;
  db.teamMembership.findUnique = async () => ({ role: 'MANAGER' }); // has MANAGE_MEMBERS

  const req: any = { params: { id: 'team1' }, user: { userId: 'manager1' } };
  const res = fakeRes();
  let nextErr: unknown;
  await listMembers(req, res, (e?: unknown) => { nextErr = e; });

  assert.equal(nextErr, undefined);
  assert.equal(res.body[0].user.email, 'a@b.com', 'a manager must see member emails');
}

// 8.5.0.1: account ids and the global role are for managers too. A player
// keeps their own id (the "(you)" label reads it); every other id is null.
const twoMembers = [
  { id: 'm1', role: 'HEAD_COACH', joinedAt: new Date(), user: { id: 'coach1', firstName: 'C', lastName: 'D', email: 'c@d.com', role: 'ADMIN', profileImage: null } },
  { id: 'm2', role: 'PLAYER', joinedAt: new Date(), user: { id: 'player1', firstName: 'P', lastName: 'Q', email: 'p@q.com', role: 'PLAYER', profileImage: null } },
];

async function listAs(userId: string | null, teamRole: string) {
  resetDb();
  db.team.findUnique = async () => ({ id: 'team1', ownerId: 'ownerX' });
  db.teamMembership.findMany = async () => twoMembers;
  db.teamMembership.findUnique = async () => ({ role: teamRole });
  const req: any = { params: { id: 'team1' }, user: userId ? { userId } : undefined };
  const res = fakeRes();
  let nextErr: unknown;
  await listMembers(req, res, (e?: unknown) => { nextErr = e; });
  assert.equal(nextErr, undefined);
  return res.body as any[];
}

async function playerSeesOnlyOwnAccountId() {
  const body = await listAs('player1', 'PLAYER');
  assert.deepEqual(body.map((m) => m.user.id), [null, 'player1']);
  assert.ok(body.every((m) => !('role' in m.user)), 'no global role for a non-manager');
  assert.deepEqual(body.map((m) => m.role), ['HEAD_COACH', 'PLAYER'], 'team roles stay');
}

async function managerSeesAllAccountIds() {
  const body = await listAs('manager1', 'MANAGER');
  assert.deepEqual(body.map((m) => m.user.id), ['coach1', 'player1']);
  assert.deepEqual(body.map((m) => m.user.role), ['ADMIN', 'PLAYER']);
}

async function anonymousSeesNoAccountIds() {
  const body = await listAs(null, 'PLAYER');
  assert.ok(body.every((m) => m.user.id === null && !('role' in m.user) && !('email' in m.user)));
}

async function main() {
  await memberWithoutManageMembersGetsNoEmails();
  await managerGetsEmails();
  await playerSeesOnlyOwnAccountId();
  await managerSeesAllAccountIds();
  await anonymousSeesNoAccountIds();
  console.log('teamMembershipController.test.ts passed');
}

main();
