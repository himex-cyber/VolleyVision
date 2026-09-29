// 6.12: the offline queue's server side on real Postgres. The only test that
// proves recordOneEvent's transaction wiring: fakePrisma runs the "transaction"
// on the same fake client, so it can't catch a scoring helper that reads
// through the module-level connection and misses the transaction's own writes
// (sets would then never complete).
import assert from 'node:assert/strict';
import { prisma, startApp, makeUser, makeTeam, cleanup, call } from './harness';
import { buildTimeline, replayTimeline } from '../lib/scoreReplay';

type Item = { matchId: string; eventType: string; isOpponentEvent: boolean; playerId?: string; setNumber: number; clientKey: string; recordedAt: string };

// A deterministic 60-tap match: our kills, their kills (opponent events score
// for them), our errors, and non-scoring digs. Enough home points to close a set.
function sixtyTaps(matchId: string, playerId: string, base: number): Item[] {
  const kinds = [
    { eventType: 'KILL', isOpponentEvent: false },
    { eventType: 'KILL', isOpponentEvent: false },
    { eventType: 'KILL', isOpponentEvent: true },
    { eventType: 'DIG', isOpponentEvent: false },
    { eventType: 'ACE', isOpponentEvent: false },
    { eventType: 'ATTACK_ERROR', isOpponentEvent: false },
  ];
  return Array.from({ length: 60 }, (_, i) => {
    const k = kinds[i % kinds.length];
    return {
      matchId, ...k, ...(k.isOpponentEvent ? {} : { playerId }), setNumber: 1,
      clientKey: `tap-${i}`, recordedAt: new Date(base + i * 10_000).toISOString(),
    };
  });
}

// Seeded shuffle, so a failure is reproducible.
function shuffled<T>(xs: T[], seed = 7): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function state(matchId: string) {
  return prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    select: { homeScore: true, awayScore: true, homeSetsWon: true, awaySetsWon: true, setScores: true },
  });
}

async function main() {
  const app = await startApp();
  try {
    const coach = await makeUser('coach');
    const team = await makeTeam(coach, 'Offline');
    const player = await prisma.player.create({ data: { teamId: team.id, firstName: 'O', lastName: 'Q', jerseyNumber: 9, position: 'OUTSIDE_HITTER' } });
    const base = Date.now() - 30 * 60_000;
    const newMatch = () => prisma.match.create({
      data: { teamId: team.id, opponent: 'Replay', matchDate: new Date(), status: 'IN_PROGRESS', createdAt: new Date(base - 60 * 60_000) },
    });
    const batch = (matchId: string, events: Item[]) =>
      call(app.base, 'POST', '/api/v1/events/batch', coach.token, { matchId, events });

    // Expected: the pure replay of the taps in the order they happened.
    const ordered = sixtyTaps('x', player.id, base);
    const expected = replayTimeline(buildTimeline(
      ordered.map((t) => ({ eventType: t.eventType, isOpponentEvent: t.isOpponentEvent, recordedAt: new Date(t.recordedAt) })), [],
    ));
    assert.ok(expected.homeSetsWon + expected.awaySetsWon >= 1, 'the fixture must complete a set');
    const want = { homeScore: expected.homeScore, awayScore: expected.awayScore, homeSetsWon: expected.homeSetsWon, awaySetsWon: expected.awaySetsWon, setScores: expected.setScores };

    // In order, in batches: the increment path (set completion inside the tx).
    const inOrder = await newMatch();
    for (let i = 0; i < 60; i += 20) {
      const r = await batch(inOrder.id, sixtyTaps(inOrder.id, player.id, base).slice(i, i + 20));
      assert.equal(r.status, 200);
      assert.ok(r.body.results.every((x: any) => x.status === 'created'), JSON.stringify(r.body.results.find((x: any) => x.status !== 'created')));
    }
    assert.deepEqual(await state(inOrder.id), want, 'in-order batches match the replay, completed sets included');
    assert.equal(
      await prisma.event.count({ where: { matchId: inOrder.id, completedSet: true } }), want.setScores.length,
      'checkSetCompletion(tx) marked the tap that closed each set',
    );

    // Shuffled: the out-of-order replay path. Same final state.
    const shuffledMatch = await newMatch();
    const taps = shuffled(sixtyTaps(shuffledMatch.id, player.id, base));
    for (let i = 0; i < 60; i += 20) {
      const r = await batch(shuffledMatch.id, taps.slice(i, i + 20));
      assert.equal(r.status, 200);
      assert.ok(r.body.results.every((x: any) => x.status === 'created'));
    }
    assert.deepEqual(await state(shuffledMatch.id), want, 'shuffled posts end where an in-order replay does');

    // Resending a whole batch changes nothing.
    const again = await batch(shuffledMatch.id, taps.slice(0, 20));
    assert.ok(again.body.results.every((x: any) => x.status === 'duplicate'));
    assert.equal(await prisma.event.count({ where: { matchId: shuffledMatch.id } }), 60);
    assert.deepEqual(await state(shuffledMatch.id), want);

    // Two concurrent posts with one key: one row and one point, whatever the
    // loser was told (a 200 duplicate or a retryable 409).
    const race = await newMatch();
    const kill = { matchId: race.id, playerId: player.id, eventType: 'KILL', isOpponentEvent: false, setNumber: 1, clientKey: 'same', recordedAt: new Date(base).toISOString() };
    const [a, b] = await Promise.all([batch(race.id, [kill]), batch(race.id, [kill])]);
    for (const r of [a, b]) {
      assert.equal(r.status, 200);
      assert.ok(['created', 'duplicate', 'retry'].includes(r.body.results[0].status));
    }
    assert.equal(await prisma.event.count({ where: { matchId: race.id } }), 1, 'one row');
    assert.equal((await state(race.id)).homeScore, 1, 'one point');

    // The single route: a keyed resend is 200, and the same key on another
    // match is a different tap (keys are per match).
    const single = (matchId: string, key?: string) => fetch(`${app.base}/api/v1/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${coach.token}`, 'content-type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify({ matchId, playerId: player.id, eventType: 'ACE', setNumber: 1 }),
    });
    const other = await newMatch();
    const first = await single(other.id, 'same');
    assert.equal(first.status, 201, 'a key is scoped to its match');
    const resend = await single(other.id, 'same');
    assert.equal(resend.status, 200, 'resend');
    assert.equal(((await resend.json()) as any).id, ((await first.json()) as any).id, 'a duplicate returns the original event');
    assert.equal(await prisma.event.count({ where: { matchId: other.id } }), 1);

    // Old apps: no key, no time. Still 201, one point per tap, server time.
    const old = await newMatch();
    for (let i = 0; i < 2; i++) assert.equal((await single(old.id)).status, 201);
    const oldRows = await prisma.event.findMany({ where: { matchId: old.id } });
    assert.equal(oldRows.length, 2, 'no key means no dedupe');
    assert.ok(oldRows.every((e) => e.clientKey === null && Date.now() - e.recordedAt.getTime() < 60_000));
    assert.equal((await state(old.id)).homeScore, 2);

    // Reset Set, then a tap from earlier in the set syncs: the reset holds
    // (the match is under manual override, so the late point only adds).
    const reset = await newMatch();
    const early = sixtyTaps(reset.id, player.id, base).filter((t) => t.eventType === 'KILL' && !t.isOpponentEvent);
    await batch(reset.id, early.slice(1, 6));
    assert.equal((await state(reset.id)).homeScore, 5);
    assert.equal((await call(app.base, 'POST', `/api/v1/matches/${reset.id}/score/reset`, coach.token)).status, 200);
    await batch(reset.id, [early[0]]); // made before the others, synced after the reset
    assert.equal((await state(reset.id)).homeScore, 1, 'the reset is not replayed away');

    // A manual score change between offline taps: the replay keeps it in time order.
    const adjusted = await newMatch();
    const mixed = sixtyTaps(adjusted.id, player.id, base).slice(0, 12);
    await batch(adjusted.id, mixed.slice(6)); // the later half first
    await prisma.scoreAdjustment.create({ data: { matchId: adjusted.id, homeDelta: 1, awayDelta: 0, setNumber: 1, createdAt: new Date(base + 55_000) } });
    await batch(adjusted.id, mixed.slice(0, 6)); // then the earlier half, out of order
    const expectAdj = replayTimeline(buildTimeline(
      mixed.map((t) => ({ eventType: t.eventType, isOpponentEvent: t.isOpponentEvent, recordedAt: new Date(t.recordedAt) })),
      [{ homeDelta: 1, awayDelta: 0, createdAt: new Date(base + 55_000) }],
    ));
    const gotAdj = await state(adjusted.id);
    assert.deepEqual([gotAdj.homeScore, gotAdj.awayScore], [expectAdj.homeScore, expectAdj.awayScore]);

    // Timing (6.4): a full batch (MAX_EVENT_BATCH = 20), in order and shuffled.
    for (const [label, order] of [['in order', (x: Item[]) => x], ['shuffled', shuffled]] as const) {
      const timed = await newMatch();
      const full = order(sixtyTaps(timed.id, player.id, base).slice(0, 20));
      const t0 = Date.now();
      const r = await batch(timed.id, full);
      assert.equal(r.status, 200);
      console.log(`20-item batch, ${label}: ${Date.now() - t0} ms`);
    }
    assert.equal((await batch(inOrder.id, sixtyTaps(inOrder.id, player.id, base).slice(0, 21))).status, 400, 'the cap');

    console.log('offlineReplay.test.ts passed');
  } finally {
    await app.close();
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
