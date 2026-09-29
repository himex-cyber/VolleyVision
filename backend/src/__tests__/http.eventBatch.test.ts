// 6.4 POST /events/batch: guards, matchId pinning, per-item outcomes in order,
// and its own rate limit.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { withServer, tokenFor, send } from '../testing/http';
import { AppError } from '../middleware/errorHandler';

const MEMBERS: Record<string, string> = { coach: 'HEAD_COACH', stat: 'STATISTICIAN', ann: 'PLAYER', viewer: 'VIEWER' };

function world(opts: { conflictOn?: string; crashOn?: string } = {}) {
  resetDb();
  const rows: any[] = [];
  db.user.findUnique = async () => ({ tokenVersion: 0, role: 'COACH', emailVerifiedAt: new Date() });
  db.team.findUnique = async (args: any) => (args.where.id === 'T' ? { id: 'T', ownerId: 'coach' } : null);
  db.teamMembership.findUnique = async (args: any) => {
    const { userId, teamId } = args.where.userId_teamId;
    return teamId === 'T' && MEMBERS[userId] ? { id: `m-${userId}`, role: MEMBERS[userId], accessTiers: {} } : null;
  };
  db.match.findUnique = async (args: any) =>
    args.where.id === 'm1'
      ? { teamId: 'T', createdAt: new Date('2026-01-01T00:00:00Z'), manualScoreOverride: false, status: 'IN_PROGRESS', homeScore: 0, awayScore: 0, homeSetsWon: 0, awaySetsWon: 0, setScores: [] }
      : null;
  db.player.findFirst = async () => ({ id: 'p1' });
  db.event.findUnique = async (args: any) => rows.find((r) => r.clientKey === args.where.matchId_clientKey.clientKey) ?? null;
  db.event.findFirst = async () => null;
  db.scoreAdjustment.findFirst = async () => null;
  db.event.create = async (args: any) => {
    if (args.data.clientKey === opts.conflictOn) {
      throw new AppError(409, 'Someone else changed this at the same moment. Please try again.', 'SERIALIZATION_CONFLICT');
    }
    if (args.data.clientKey === opts.crashOn) throw new Error('connection reset');
    const row = { id: `e-${args.data.clientKey}`, ...args.data };
    rows.push(row);
    return row;
  };
  db.match.update = async () => ({});
  return rows;
}

async function post(base: string, who: string, body: unknown) {
  const res = await fetch(`${base}/api/v1/events/batch`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenFor(who)}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

const item = (clientKey: string, extra: Record<string, unknown> = {}) =>
  ({ matchId: 'm1', playerId: 'p1', eventType: 'DIG', setNumber: 1, clientKey, ...extra });

async function main() {
  await withServer(async (base) => {
    // Guards: 401, outsider 404, non-tracker 403.
    world();
    assert.equal(await send(base, 'POST', '/api/v1/events/batch', undefined, { matchId: 'm1', events: [item('a')] }), 401);
    assert.equal((await post(base, 'out', { matchId: 'm1', events: [item('a')] })).status, 404);
    assert.equal((await post(base, 'ann', { matchId: 'm1', events: [item('a')] })).status, 403);
    assert.equal((await post(base, 'viewer', { matchId: 'm1', events: [item('a')] })).status, 403);
    assert.equal(callsFor('event', 'create').length, 0);

    // Created, duplicate (repeated key), rejected (bad item), and later items still run.
    let rows = world();
    let r = await post(base, 'stat', {
      matchId: 'm1',
      events: [item('a'), item('a'), item('b', { eventType: 'SPIKE' }), item('c', { eventType: 'KILL' })],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.results.map((x: any) => [x.clientKey, x.status]), [['a', 'created'], ['a', 'duplicate'], ['b', 'rejected'], ['c', 'created']]);
    assert.equal(r.body.results[2].error, 'Unknown event type.');
    assert.equal(r.body.results[0].event.clientKey, 'a');
    assert.deepEqual(rows.map((x) => x.clientKey), ['a', 'c'], 'in array order');

    // A serialization conflict stops the batch: that item and every later one are "retry".
    rows = world({ conflictOn: 'b' });
    r = await post(base, 'coach', { matchId: 'm1', events: [item('a'), item('b'), item('c')] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.results.map((x: any) => x.status), ['created', 'retry', 'retry']);
    assert.deepEqual(rows.map((x) => x.clientKey), ['a'], 'nothing after the conflict was written');

    // Anything unexpected fails the whole request (the device resends it).
    world({ crashOn: 'b' });
    r = await post(base, 'coach', { matchId: 'm1', events: [item('a'), item('b')] });
    assert.equal(r.status, 500);

    // Pinning and shape: refused before any write.
    world();
    const refused = [
      { matchId: 'm1', events: [item('a'), item('b', { matchId: 'm2' })] }, // another match
      { matchId: 'm1', events: [item('a'), { ...item('b'), matchId: undefined }] },
      { matchId: 'm1', events: [item('a'), item('')] }, // no key
      { matchId: 'm1', events: [item('a'), item('x'.repeat(129))] },
      { matchId: 'm1', events: [] },
      { matchId: 'm1', events: Array.from({ length: 21 }, (_, i) => item(`k${i}`)) },
      { matchId: 'm1', events: 'nope' },
      { matchId: 'm1', events: [item('a'), null] },
    ];
    for (const body of refused) assert.equal((await post(base, 'coach', body)).status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(callsFor('event', 'create').length, 0, 'nothing written on a refused batch');
    assert.equal((await post(base, 'coach', { matchId: 'm2', events: [item('a', { matchId: 'm2' })] })).status, 404, 'unknown match');

    // Its own rate limit: 600 per 10 minutes per user (every live tap is a
    // batch), separate from single writes.
    world();
    let limited = false;
    for (let i = 0; i < 620 && !limited; i++) limited = (await send(base, 'POST', '/api/v1/events/batch', tokenFor('limit'), {})) === 429;
    assert.ok(limited, 'batches are rate-limited');
    assert.notEqual(await send(base, 'POST', '/api/v1/events', tokenFor('limit'), {}), 429, 'single writes have their own budget');
    assert.notEqual(await send(base, 'POST', '/api/v1/events/batch', tokenFor('other'), {}), 429, 'per user');
  });
  console.log('http.eventBatch.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
