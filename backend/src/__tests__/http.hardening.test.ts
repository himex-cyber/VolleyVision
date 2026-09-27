// Roadmap defect 7, the low-severity gaps, one case per fix. Each runs the
// real app over the fake Prisma client.
import assert from 'node:assert/strict';
import { db, resetDb } from '../testing/installFakePrisma';
import { withServer, tokenFor, send } from '../testing/http';
import { createTeamInvitation } from '../controllers/invitation';

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

// Chat answered non-members 403, which confirms the channel or message exists.
// Everything team-scoped answers an outsider 404.
async function chatIsNotFoundForOutsiders(base: string) {
  world();
  db.channel.findUnique = async () => ({ id: 'C', teamId: 'T' });
  db.message.findUnique = async () => ({ id: 'M', senderId: 'coach', channel: { teamId: 'T' }, channelId: 'C' });
  const outsider = tokenFor('outsider');
  assert.equal(await send(base, 'GET', '/api/v1/channels/C/messages', outsider), 404);
  assert.equal(await send(base, 'POST', '/api/v1/channels/C/messages', outsider, { body: 'hi' }), 404);
  assert.equal(await send(base, 'PATCH', '/api/v1/messages/M', outsider, { body: 'edited' }), 404);
  assert.equal(await send(base, 'DELETE', '/api/v1/messages/M', outsider), 404);
}

// A JSON body can carry any type. A non-string email reached .trim() and
// became a 500; it's the caller's mistake, so 400.
async function nonStringEmailIs400(base: string) {
  world();
  db.user.findUnique = async () => null;
  assert.equal(await send(base, 'POST', '/api/v1/auth/login', undefined, { email: 123, password: 'x' }), 400);
  assert.equal(await send(base, 'POST', '/api/v1/auth/forgot-password', undefined, { email: { $ne: '' } }), 400);
  assert.equal(await send(base, 'POST', '/api/v1/auth/register', undefined, { email: ['a@b.co'], password: 'longenough1', firstName: 'A', lastName: 'B' }), 400);
  assert.equal(await send(base, 'POST', '/api/v1/auth/register', undefined, { email: 'not-an-address', password: 'longenough1', firstName: 'A', lastName: 'B' }), 400);
  // Invitations: called directly, since the HTTP route's budget is spent above.
  let status = 0;
  const res: any = { status: (c: number) => { status = c; return res; }, json: () => res };
  await createTeamInvitation({ params: { id: 'T' }, body: { email: 42, role: 'PLAYER' }, user: { userId: 'coach' } } as any, res, () => {});
  assert.equal(status, 400);
}

// ?limit=abc became take: NaN, which Prisma rejects: a 500. Clamp to 1..200,
// defaulting to 50 for anything that isn't a number.
async function auditLimitIsClamped(base: string) {
  world();
  const takes: unknown[] = [];
  db.auditLog.findMany = async (args: any) => { takes.push(args.take); return []; };
  const token = tokenFor('coach');
  for (const limit of ['abc', '0', '-5', '1000', '25']) {
    assert.equal(await send(base, 'GET', `/api/v1/audit?limit=${limit}`, token), 200);
  }
  assert.deepEqual(takes, [50, 50, 1, 200, 25]); // 0 isn't a usable limit, so it's the default
}

async function main() {
  await withServer(async (base) => {
    await invitationsAreRateLimited(base);
    await eventWritesAreRateLimited(base);
    await chatIsNotFoundForOutsiders(base);
    await nonStringEmailIs400(base);
    await auditLimitIsClamped(base);
  });
  console.log('http.hardening.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
