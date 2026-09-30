// 8.0.3 on real Postgres: the replay keeps the completedSet marks in step. An
// out-of-order tap moves which point closed Set 1; after a Reset Set the match
// is under manual override, where undo trusts the marks. A mark left on the
// old closer made that undo take Set 1 away.
import assert from 'node:assert/strict';
import { prisma, startApp, makeUser, makeTeam, cleanup, call } from './harness';

async function main() {
  const app = await startApp();
  try {
    const coach = await makeUser('coach');
    const team = await makeTeam(coach, 'Marks');
    const player = await prisma.player.create({ data: { teamId: team.id, firstName: 'M', lastName: 'K', jerseyNumber: 7, position: 'OUTSIDE_HITTER' } });
    const base = Date.now() - 20 * 60_000;
    const match = await prisma.match.create({
      data: { teamId: team.id, opponent: 'Marks', matchDate: new Date(), status: 'IN_PROGRESS', createdAt: new Date(base - 60_000) },
    });
    const kill = (key: string, at: number) => ({
      matchId: match.id, playerId: player.id, eventType: 'KILL', isOpponentEvent: false, setNumber: 1,
      clientKey: key, recordedAt: new Date(at).toISOString(),
    });
    const batch = async (events: unknown[]) => {
      const r = await call(app.base, 'POST', '/api/v1/events/batch', coach.token, { matchId: match.id, events });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.ok(r.body.results.every((x: any) => x.status === 'created'));
    };
    const marked = async () => (await prisma.event.findMany({
      where: { matchId: match.id, completedSet: true }, select: { clientKey: true },
    })).map((e) => e.clientKey);
    const score = () => prisma.match.findUniqueOrThrow({
      where: { id: match.id }, select: { homeScore: true, awayScore: true, homeSetsWon: true },
    });

    // 25 kills in order: k25 closes Set 1.
    const kills = Array.from({ length: 25 }, (_, i) => kill(`k${i + 1}`, base + i * 1000));
    await batch(kills.slice(0, 20));
    await batch(kills.slice(20));
    assert.deepEqual(await marked(), ['k25']);
    assert.deepEqual(await score(), { homeScore: 0, awayScore: 0, homeSetsWon: 1 });

    // A tap made between k1 and k2 syncs late: k24 is now the 25th point and
    // k25 is the first point of Set 2.
    await batch([kill('late', base + 500)]);
    assert.deepEqual(await marked(), ['k24'], 'the replay moved the mark');
    assert.deepEqual(await score(), { homeScore: 1, awayScore: 0, homeSetsWon: 1 });

    // Reset Set 2, then undo the last tap (k25).
    const reset = await call(app.base, 'POST', `/api/v1/matches/${match.id}/score/reset`, coach.token);
    assert.equal(reset.status, 200);
    const undo = await call(app.base, 'DELETE', `/api/v1/events/undo/${match.id}`, coach.token);
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
    assert.equal(undo.body.kind, 'event');
    assert.deepEqual(await score(), { homeScore: 0, awayScore: 0, homeSetsWon: 1 }, 'Set 1 is still won');

    // 9.0.5: set numbers follow the replay too. A manual +1 closes Set 1 and a
    // kill opens Set 2; two late taps then move the boundary back by two points,
    // so both belong to Set 2. Reset Set (Set 2) must take that adjustment.
    const m2 = await prisma.match.create({
      data: { teamId: team.id, opponent: 'Sets', matchDate: new Date(), status: 'IN_PROGRESS', createdAt: new Date(base - 60_000) },
    });
    const tap = (key: string, at: number, setNumber: number) => ({ ...kill(key, at), matchId: m2.id, setNumber });
    const batch2 = async (events: unknown[]) => {
      const r = await call(app.base, 'POST', '/api/v1/events/batch', coach.token, { matchId: m2.id, events });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    };
    const early = Array.from({ length: 24 }, (_, i) => tap(`s${i + 1}`, base + i * 1000, 1));
    await batch2(early.slice(0, 20));
    await batch2(early.slice(20));
    const plus = await call(app.base, 'PATCH', `/api/v1/matches/${m2.id}/score`, coach.token, { homeDelta: 1 });
    assert.equal(plus.status, 200, JSON.stringify(plus.body));
    assert.equal(plus.body.homeSetsWon, 1, 'the +1 closed Set 1');
    await batch2([tap('s25', Date.now(), 2)]);
    await batch2([tap('late1', base + 500, 1)]);
    await batch2([tap('late2', base + 600, 1)]);

    const setOf = async () => Object.fromEntries((await prisma.event.findMany({
      where: { matchId: m2.id, clientKey: { in: ['s23', 's24', 's25', 'late1'] } }, select: { clientKey: true, setNumber: true },
    })).map((e) => [e.clientKey, e.setNumber]));
    assert.deepEqual(await setOf(), { s23: 1, s24: 2, s25: 2, late1: 1 }, 'events moved to the set they were played in');
    const [adjustment] = await prisma.scoreAdjustment.findMany({ where: { matchId: m2.id } });
    assert.equal(adjustment.setNumber, 2, 'the adjustment moved to Set 2');

    const reset2 = await call(app.base, 'POST', `/api/v1/matches/${m2.id}/score/reset`, coach.token);
    assert.equal(reset2.status, 200);
    assert.equal(await prisma.scoreAdjustment.count({ where: { matchId: m2.id } }), 0, "Reset Set took Set 2's adjustment");

    console.log('setMarks: all tests passed');
  } finally {
    await app.close();
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
