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
