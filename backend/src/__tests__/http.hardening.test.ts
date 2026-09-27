// Roadmap defect 7, the low-severity gaps, one case per fix. Each runs the
// real app over the fake Prisma client.
import assert from 'node:assert/strict';
import { db, resetDb } from '../testing/installFakePrisma';
import { withServer, tokenFor, send } from '../testing/http';

// "coach" owns team T; nobody else belongs to it.
function world() {
  resetDb();
  db.user.findUnique = async () => ({ tokenVersion: 0, role: 'COACH' });
  db.team.findUnique = async (args: any) => (args.where.id === 'T' ? { id: 'T', ownerId: 'coach' } : null);
  db.teamMembership.findUnique = async () => null;
}

// Each invitation mails an address the caller picks, so an unlimited endpoint
// is a mail cannon. 20 per hour per team (and per user).
async function invitationsAreRateLimited(base: string) {
  world();
  const token = tokenFor('coach');
  const statuses: number[] = [];
  // Empty body: the controller answers 400 without sending anything, which is
  // enough to prove the limiter let the request through.
  for (let i = 0; i < 21; i++) statuses.push(await send(base, 'POST', '/api/v1/teams/T/invitations', token, {}));
  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(400));
  assert.equal(statuses[20], 429, 'the 21st invitation in an hour must be refused');
}

async function main() {
  await withServer(async (base) => {
    await invitationsAreRateLimited(base);
  });
  console.log('http.hardening.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
