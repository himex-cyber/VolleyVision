// Regression tests for services/emailVerification.service.ts: assertEmailVerified
// is the gate every self-service "join a team" action calls first, and
// verifyEmail's conditional updateMany is what makes a token single-use.
import assert from 'node:assert/strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

import { db, resetDb } from '../testing/installFakePrisma';
import { assertEmailVerified, verifyEmail } from '../services/emailVerification.service';

async function assertEmailVerifiedThrowsForUnverifiedUser() {
  resetDb();
  db.user.findUnique = async () => ({ emailVerifiedAt: null });
  try {
    await assertEmailVerified('u1');
  } catch (err: any) {
    assert.equal(err.statusCode, 403);
    assert.equal(err.code, 'EMAIL_NOT_VERIFIED');
    return;
  }
  assert.fail('expected a rejection');
}

async function assertEmailVerifiedPassesForVerifiedUser() {
  resetDb();
  db.user.findUnique = async () => ({ emailVerifiedAt: new Date() });
  await assertEmailVerified('u1'); // must not throw
}

async function verifyEmailZeroCountIs400() {
  resetDb();
  db.user.updateMany = async () => ({ count: 0 });
  try {
    await verifyEmail('bad-token');
  } catch (err: any) {
    assert.equal(err.statusCode, 400);
    return;
  }
  assert.fail('expected a rejection');
}

async function main() {
  await assertEmailVerifiedThrowsForUnverifiedUser();
  await assertEmailVerifiedPassesForVerifiedUser();
  await verifyEmailZeroCountIs400();
  console.log('emailVerification.test.ts passed');
}

main();
