// transferOwnership regression: refused when the transfer would leave a third
// assistant; on success the old owner is demoted BEFORE the new owner is
// promoted (the partial unique index allows only one HEAD_COACH per team, so
// promoting first would violate it); self-transfer and non-owner callers are
// rejected before any write.
import assert from 'node:assert/strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { transferOwnership } from '../services/teamOwnership.service';

async function assertRejects(fn: () => Promise<unknown>, statusCode: number) {
  try {
    await fn();
  } catch (err: any) {
    assert.equal(err.statusCode, statusCode);
    return;
  }
  assert.fail('expected a rejection');
}

function stubHappyPath() {
  db.team.findUnique = async () => ({ id: 'team1', ownerId: 'owner1' });
  db.teamMembership.findFirst = async () => ({ id: 'm-new', userId: 'newOwner1' });
}

async function refusedWhenTwoOtherAssistantsAlreadyTaken() {
  resetDb();
  stubHappyPath();
  db.teamMembership.count = async () => 2; // two OTHER members are assistants
  await assertRejects(() => transferOwnership('team1', 'owner1', 'new@owner.com'), 409);
  assert.equal(callsFor('teamMembership', 'updateMany').length, 0);
  assert.equal(callsFor('teamMembership', 'update').length, 0);
}

async function demotesOldOwnerBeforePromotingNewOwner() {
  resetDb();
  stubHappyPath();
  db.teamMembership.count = async () => 0;
  const order: string[] = [];
  db.teamMembership.updateMany = async (args: any) => { order.push('updateMany'); assert.equal(args.data.role, 'ASSISTANT_COACH'); return { count: 1 }; };
  db.teamMembership.update = async (args: any) => { order.push('update'); assert.equal(args.data.role, 'HEAD_COACH'); return { id: 'm-new' }; };
  db.team.update = async (args: any) => { order.push('team.update'); return { id: 'team1', ownerId: args.data.ownerId }; };

  await transferOwnership('team1', 'owner1', 'new@owner.com');

  assert.deepEqual(order, ['updateMany', 'update', 'team.update'], 'old owner must be demoted before the new owner is promoted');
}

async function transferringToYourselfIs400() {
  resetDb();
  db.team.findUnique = async () => ({ id: 'team1', ownerId: 'owner1' });
  db.teamMembership.findFirst = async () => ({ id: 'm-self', userId: 'owner1' });
  await assertRejects(() => transferOwnership('team1', 'owner1', 'owner1@self.com'), 400);
}

async function nonOwnerIs403() {
  resetDb();
  db.team.findUnique = async () => ({ id: 'team1', ownerId: 'owner1' });
  await assertRejects(() => transferOwnership('team1', 'notTheOwner', 'new@owner.com'), 403);
  assert.equal(callsFor('teamMembership', 'findFirst').length, 0, 'must not even look up the target when the caller is not the owner');
}

async function main() {
  await refusedWhenTwoOtherAssistantsAlreadyTaken();
  await demotesOldOwnerBeforePromotingNewOwner();
  await transferringToYourselfIs400();
  await nonOwnerIs403();
  console.log('teamOwnership.test.ts passed');
}

main();
