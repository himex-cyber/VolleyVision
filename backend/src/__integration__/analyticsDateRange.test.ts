// 8.3 on real Postgres: matches on three dates, filtered by from/to. The
// counts, the stats and the trend points all come from the same matches, and
// `to` takes in its whole day (a match late on the end day is in).
import assert from 'node:assert/strict';
import { prisma, startApp, makeUser, makeTeam, cleanup, call } from './harness';

async function main() {
  const app = await startApp();
  try {
    const coach = await makeUser('coach');
    const team = await makeTeam(coach, 'Dates');
    const player = await prisma.player.create({ data: { teamId: team.id, firstName: 'D', lastName: 'R', jerseyNumber: 5, position: 'OUTSIDE_HITTER' } });
    // n kills in a completed match on the given date.
    const matchOn = async (iso: string, kills: number) => {
      const m = await prisma.match.create({ data: { teamId: team.id, opponent: iso, matchDate: new Date(iso), status: 'COMPLETED' } });
      await prisma.event.createMany({
        data: Array.from({ length: kills }, () => ({ matchId: m.id, playerId: player.id, eventType: 'KILL' as const, setNumber: 1 })),
      });
    };
    await matchOn('2026-09-01T18:00:00.000Z', 1);
    await matchOn('2026-09-15T18:00:00.000Z', 2);
    await matchOn('2026-09-30T23:30:00.000Z', 4); // late on the end day

    const team_ = (qs: string) => call(app.base, 'GET', `/api/v1/analytics/teams/${team.id}${qs}`, coach.token);

    const all = await team_('');
    assert.equal(all.status, 200);
    assert.equal(all.body.teamStats.kills, 7);
    assert.equal(all.body.matchSummary.completed, 3);
    assert.equal(all.body.dateRange, null);

    const oneDay = await team_('?from=2026-09-15&to=2026-09-15');
    assert.equal(oneDay.body.teamStats.kills, 2, 'one day, one match');
    assert.equal(oneDay.body.matchSummary.total, 1);
    assert.deepEqual(oneDay.body.dateRange, { from: '2026-09-15', to: '2026-09-15' });

    const toEnd = await team_('?from=2026-09-02&to=2026-09-30');
    assert.equal(toEnd.body.teamStats.kills, 6, 'the 23:30 match on the end day is in');
    assert.equal(toEnd.body.matchSummary.completed, 2);

    const trends = await call(app.base, 'GET', `/api/v1/analytics/teams/${team.id}/trends?to=2026-09-15`, coach.token);
    assert.deepEqual(trends.body.map((t: any) => t.kills), [1, 2]);

    const player_ = await call(app.base, 'GET', `/api/v1/analytics/players/${player.id}?from=2026-09-15`, coach.token);
    assert.equal(player_.body.stats.kills, 6);

    const list = await call(app.base, 'GET', `/api/v1/matches/by-team/${team.id}?from=2026-09-30&to=2026-09-30`, coach.token);
    assert.equal(list.body.length, 1, 'the matches list takes in the whole end day too');

    const bad = await team_('?from=2026-09-30&to=2026-09-01');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'The start date is after the end date.');

    console.log('analyticsDateRange (integration): all tests passed');
  } finally {
    await app.close();
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
