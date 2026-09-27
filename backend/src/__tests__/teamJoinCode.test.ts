// redeemTeamJoinCode regression: an unverified user must be rejected by
// assertEmailVerified before any team lookup or membership write happens —
// the H3/email-verification gate applies to join codes exactly like
// invitations and player claims.
import assert from 'node:assert/strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { redeemTeamJoinCode } from '../services/teamJoinCode.service';

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
  console.log('teamJoinCode.test.ts passed');
}

main();
