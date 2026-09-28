// Roadmap defect 7: invitations are stored with a normalised email, but the
// duplicate check compared the raw input, so " Coach@Club.nz " slipped past a
// pending invite for "coach@club.nz" and the same person got two.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { createInvitation } from '../services/invitation.service';

async function main() {
  resetDb();
  db.team.findUnique = async () => ({ id: 't1' });
  // One pending invite exists, stored normalised as every invite is.
  db.invitation.findFirst = async (args: any) => (args.where.email === 'coach@club.nz' ? { id: 'inv1' } : null);
  try {
    await createInvitation('t1', 'u1', '  Coach@Club.NZ ', 'ASSISTANT_COACH' as any);
    assert.fail('expected the duplicate to be refused');
  } catch (err: any) {
    assert.equal(err.statusCode, 409, `expected 409, got: ${err.message}`);
  }
  assert.equal(callsFor('invitation', 'create').length, 0);
  console.log('invitationDuplicate.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
