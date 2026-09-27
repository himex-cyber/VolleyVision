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
  db.match.findUnique = async () => null;
  db.event.findUnique = async () => null;
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

// Live tracking writes an event per touch; a runaway client (or a script) could
// otherwise write without bound. 600 per 10 minutes per user, sized so a
// device flushing a match's offline queue still fits (roadmap Phase 6).
async function eventWritesAreRateLimited(base: string) {
  world();
  const token = tokenFor('tracker');
  let last = 0;
  // No matchId: the permission guard answers 400, proving the limiter passed it.
  for (let i = 0; i < 600; i++) {
    last = await send(base, i % 3 === 0 ? 'DELETE' : 'POST', i % 3 === 0 ? '/api/v1/events/undo/none' : '/api/v1/events', token, {});
    if (last === 429) assert.fail(`request ${i + 1} of 600 was limited`);
  }
  // The bucket refills about one token a second while the 600 run, so allow a
  // few more through before it must refuse.
  let limited = false;
  for (let i = 0; i < 30 && !limited; i++) limited = (await send(base, 'POST', '/api/v1/events', token, {})) === 429;
  assert.ok(limited, 'event writes past the budget must be refused');
  assert.equal(await send(base, 'DELETE', '/api/v1/events/e1', token), 429, 'deletes share the budget');
  assert.notEqual(await send(base, 'POST', '/api/v1/events', tokenFor('other'), {}), 429, 'per user, not global');
}

async function main() {
  await withServer(async (base) => {
    await invitationsAreRateLimited(base);
    await eventWritesAreRateLimited(base);
  });
  console.log('http.hardening.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
