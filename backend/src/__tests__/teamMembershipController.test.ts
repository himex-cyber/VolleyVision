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

async function main() {
  await memberWithoutManageMembersGetsNoEmails();
  await managerGetsEmails();
  console.log('teamMembershipController.test.ts passed');
}

main();
