// redeemTeamJoinCode regression: an unverified user must be rejected by
// assertEmailVerified before any team lookup or membership write happens —
// the H3/email-verification gate applies to join codes exactly like
// invitations and player claims.
//
// Roadmap defect 1: the staff code goes only to members with FULL_ACCESS on
// invitations (the same bar as regenerating it), and it can no longer make
// anyone a MANAGER — that role comes only from an email invite, which runs
// through canInviteRole and the approval queue.
import assert from 'node:assert/strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { redeemTeamJoinCode } from '../services/teamJoinCode.service';
import { listTeamJoinCodes } from '../controllers/teamJoinCode';

async function listAs(tier: 'APPROVAL_REQUIRED' | 'FULL_ACCESS') {
  resetDb();
  const row: Record<string, string> = { ownerId: 'owner1', playerJoinCode: 'PLAYER01', staffJoinCode: 'STAFF001' };
  // Returns only the selected columns, like Prisma.
  db.team.findUnique = async (args: any) =>
    Object.fromEntries(Object.keys(args.select).filter((k) => args.select[k]).map((k) => [k, row[k]]));
  db.teamMembership.findUnique = async () => ({ rosterAccess: tier, invitationAccess: tier, matchAccess: tier });
  let body: any;
  const res: any = { json: (b: any) => { body = b; return res; }, status: () => res };
  await listTeamJoinCodes({ params: { id: 'team1' }, user: { userId: 'u1' } } as any, res, (err: unknown) => { throw err; });
  return body;
}

async function staffCodeHiddenBelowFullAccess() {
  const body = await listAs('APPROVAL_REQUIRED');
  assert.equal(body.playerJoinCode, 'PLAYER01');
  assert.ok(!('staffJoinCode' in body), 'an APPROVAL_REQUIRED member (assistant/statistician default) must not see the staff code');
  // Not even selected from the database, so it can't leak through a later refactor.
  assert.ok(!callsFor('team', 'findUnique').some((c) => c[0].select?.staffJoinCode), 'staff code must not be read');
}

async function staffCodeShownAtFullAccess() {
  const body = await listAs('FULL_ACCESS');
  assert.equal(body.staffJoinCode, 'STAFF001');
}

async function staffCodeCannotGrantManager() {
  resetDb();
  db.user.findUnique = async () => ({ emailVerifiedAt: new Date() });
  db.team.findUnique = async (args: any) => (args.where.staffJoinCode ? { id: 'team1', name: 'T' } : null);
  try {
    await redeemTeamJoinCode('STAFF001', 'u1', 'MANAGER' as any);
  } catch (err: any) {
    assert.equal(err.statusCode, 400);
    assert.equal(callsFor('teamMembership', 'create').length, 0, 'must not create a MANAGER membership');
    return;
  }
  assert.fail('a staff code must not grant MANAGER');
}

async function unverifiedUserRejectedBeforeAnyMembershipWrite() {
  resetDb();
  db.user.findUnique = async () => ({ emailVerifiedAt: null });
  // Deliberately NOT stubbing team.findUnique or teamMembership.create — if
  // redeemTeamJoinCode reached either before the verification check, the
  // fake would throw "not stubbed" instead of the 403 we're asserting for,
  // which is itself proof the gate runs first.
  try {
    await redeemTeamJoinCode('ABCD1234', 'u1');
  } catch (err: any) {
    assert.equal(err.statusCode, 403);
    assert.equal(err.code, 'EMAIL_NOT_VERIFIED');
    assert.equal(callsFor('team', 'findUnique').length, 0, 'must not look up the team code before verifying email');
    assert.equal(callsFor('teamMembership', 'create').length, 0, 'must not create a membership');
    return;
  }
  assert.fail('expected a rejection');
}

async function main() {
  await unverifiedUserRejectedBeforeAnyMembershipWrite();
  await staffCodeHiddenBelowFullAccess();
  await staffCodeShownAtFullAccess();
  await staffCodeCannotGrantManager();
  console.log('teamJoinCode.test.ts passed');
}

main();
