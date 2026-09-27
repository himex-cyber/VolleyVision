// Regression tests for middleware/permissions.ts: requireAdmin reads the role
// from the DB rather than trusting the JWT claim (M7 part 1), and
// requireTeamPermission's three outcomes (403 / next() / next(err)).
import assert from 'node:assert/strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

import { db, resetDb } from '../testing/installFakePrisma';
import { requireAdmin, requireTeamPermission } from '../middleware/permissions';
import { Permission } from '../lib/rolePermissions';

function fakeRes() {
  const res: any = { statusCode: null, body: null };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  return res;
}

function makeNext() {
  const calls: unknown[] = [];
  const next = (err?: unknown) => { calls.push(err); };
  return { next, calls };
}

// requireAdmin/requireTeamPermission are wrapped in asyncHandler, whose
// returned RequestHandler does not itself return the inner promise (Express 4
// ignores it) — it just calls fn(...).catch(next). Awaiting the middleware
// call directly therefore doesn't wait for the handler to finish; give the
// microtask queue a turn instead, same as asyncHandler.test.ts.
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function requireAdminRejectsJwtClaimingAdminForNonAdminDbUser() {
  resetDb();
  // The JWT says ADMIN (e.g. minted before a demotion); the DB, which
  // requireAdmin must actually consult, says otherwise.
  db.user.findUnique = async () => ({ role: 'PLAYER' });
  const req: any = { user: { userId: 'u1', email: 'a@b.com', role: 'ADMIN' } };
  const res = fakeRes();
  const { next, calls } = makeNext();
  await requireAdmin(req, res, next);
  await flush();
  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0);
}

async function requireAdminAllowsRealDbAdmin() {
  resetDb();
  db.user.findUnique = async () => ({ role: 'ADMIN' });
  const req: any = { user: { userId: 'u1', email: 'a@b.com', role: 'ADMIN' } };
  const res = fakeRes();
  const { next, calls } = makeNext();
  await requireAdmin(req, res, next);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], undefined);
  assert.equal(res.statusCode, null);
}

async function requireTeamPermissionRejectsWithout() {
  resetDb();
  db.team.findUnique = async () => ({ ownerId: 'someone-else' });
  db.teamMembership.findUnique = async () => ({ role: 'VIEWER' }); // no MANAGE_TEAM
  const req: any = { user: { userId: 'u1' }, params: { id: 'team1' } };
  const res = fakeRes();
  const { next, calls } = makeNext();
  await requireTeamPermission(Permission.MANAGE_TEAM)(req, res, next);
  await flush();
  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0);
}

async function requireTeamPermissionAllowsWith() {
  resetDb();
  db.team.findUnique = async () => ({ ownerId: 'u1' }); // owner -> HEAD_COACH
  db.teamMembership.findUnique = async () => null;
  const req: any = { user: { userId: 'u1' }, params: { id: 'team1' } };
  const res = fakeRes();
  const { next, calls } = makeNext();
  await requireTeamPermission(Permission.MANAGE_TEAM)(req, res, next);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], undefined);
  assert.equal(res.statusCode, null);
}

async function requireTeamPermissionDbErrorReachesNext() {
  resetDb();
  const dbErr = new Error('connection lost');
  db.team.findUnique = async () => { throw dbErr; };
  // Stubbed (even though never reached) so Promise.all's other branch
  // doesn't reject too and surface as an unhandled rejection alongside dbErr.
  db.teamMembership.findUnique = async () => null;
  const req: any = { user: { userId: 'u1' }, params: { id: 'team1' } };
  const res = fakeRes();
  const { next, calls } = makeNext();
  await requireTeamPermission(Permission.MANAGE_TEAM)(req, res, next);
  await flush();
  assert.equal(res.statusCode, null, 'a DB error must not be turned into a 403');
  assert.equal(calls.length, 1);
  assert.equal(calls[0], dbErr);
}

async function main() {
  await requireAdminRejectsJwtClaimingAdminForNonAdminDbUser();
  await requireAdminAllowsRealDbAdmin();
  await requireTeamPermissionRejectsWithout();
  await requireTeamPermissionAllowsWith();
  await requireTeamPermissionDbErrorReachesNext();
  console.log('permissions.test.ts passed');
}

main();
