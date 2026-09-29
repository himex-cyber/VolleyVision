// 8.0.1 on real Postgres: a device flushing a batch of taps and another
// device's manual +1 hit the same match at the same moment. Every writer takes
// the match lock and the +1 is sent as a delta, so neither can compute from a
// score the other is changing: the final score is always the replay of
// everything recorded, and the +1 always lands as +1.
import assert from 'node:assert/strict';
import { prisma, startApp, makeUser, makeTeam, cleanup, call } from './harness';
import { buildTimeline, replayTimeline } from '../lib/scoreReplay';

async function main() {
  const app = await startApp();
  try {
    const coach = await makeUser('coach');
    const team = await makeTeam(coach, 'Concurrency');
    const player = await prisma.player.create({ data: { teamId: team.id, firstName: 'C', lastName: 'R', jerseyNumber: 4, position: 'OUTSIDE_HITTER' } });
    const base = Date.now() - 20 * 60_000;

    for (let round = 0; round < 20; round++) {
      const match = await prisma.match.create({
        data: { teamId: team.id, opponent: `Race ${round}`, matchDate: new Date(), status: 'IN_PROGRESS', createdAt: new Date(base - 60_000) },
      });
      // 20 kills made before the +1 (so any that land after it replay).
      const taps = Array.from({ length: 20 }, (_, i) => ({
        matchId: match.id, playerId: player.id, eventType: 'KILL', isOpponentEvent: false, setNumber: 1,
        clientKey: `r${round}-${i}`, recordedAt: new Date(base + i * 1000).toISOString(),
      }));
      const [flush, plusOne] = await Promise.all([
        call(app.base, 'POST', '/api/v1/events/batch', coach.token, { matchId: match.id, events: taps }),
        call(app.base, 'PATCH', `/api/v1/matches/${match.id}/score`, coach.token, { homeDelta: 1 }),
      ]);
      assert.equal(flush.status, 200, JSON.stringify(flush.body));
      assert.ok(flush.body.results.every((x: any) => x.status === 'created'), `round ${round}: every tap saved`);
      assert.equal(plusOne.status, 200, JSON.stringify(plusOne.body));

      const [events, adjustments, final] = await Promise.all([
        prisma.event.findMany({ where: { matchId: match.id }, select: { eventType: true, isOpponentEvent: true, recordedAt: true } }),
        prisma.scoreAdjustment.findMany({ where: { matchId: match.id }, select: { homeDelta: true, awayDelta: true, createdAt: true } }),
        prisma.match.findUniqueOrThrow({ where: { id: match.id }, select: { homeScore: true, awayScore: true } }),
      ]);
      assert.deepEqual(adjustments.map((a) => [a.homeDelta, a.awayDelta]), [[1, 0]], `round ${round}: the +1 is recorded as +1`);
      const replayed = replayTimeline(buildTimeline(events, adjustments));
      assert.deepEqual(final, { homeScore: replayed.homeScore, awayScore: replayed.awayScore }, `round ${round}: score = replay`);
      assert.equal(final.homeScore, 21, `round ${round}: 20 taps + the +1, none lost`);
    }
    console.log('scoreConcurrency: all tests passed');
  } finally {
    await app.close();
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
