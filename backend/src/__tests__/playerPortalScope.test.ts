// Karlos, 28 Sept (v9.8.0 G2): the player portal counts only matches of teams
// the viewer owns or belongs to. A record can be linked to other teams
// (PlayerTeamLink), and since staff can now relink a record, whoever holds the
// link must not read those other teams' matches through the portal.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import {
  getPlayerCareerStats, getPlayerRecentMatches, getDevelopmentMetrics,
  getPlayerBests, getPlayerStatsByTeam, getPlayerUpcomingMatches,
} from '../services/playerPortal.service';

// Record P: home team A, also linked to team B. The viewer belongs to A only.
function world() {
  resetDb();
  db.player.findMany = async () => [{ id: 'P', teamId: 'A', team: { id: 'A', name: 'A', season: null } }];
  db.team.findMany = async () => [];
  db.teamMembership.findMany = async () => [{ teamId: 'A' }];
  db.playerTeamLink.findMany = async () => [{ teamId: 'B' }];
  db.event.findMany = async () => [{ matchId: 'M1', eventType: 'KILL' }];
  db.match.findMany = async () => [{ id: 'M1', opponent: 'X', matchDate: new Date(0) }];
}

const SCOPED = { teamId: { in: ['A'] } };

async function main() {
  for (const [name, fn] of [
    ['career', getPlayerCareerStats], ['recent', getPlayerRecentMatches], ['development', getDevelopmentMetrics],
    ['bests', getPlayerBests], ['byTeam', getPlayerStatsByTeam],
  ] as const) {
    world();
    await fn('viewer');
    const calls = callsFor('event', 'findMany');
    assert.ok(calls.length > 0, name);
    for (const [args] of calls) assert.deepEqual(args.where.match, SCOPED, `${name}: every event read is limited to the viewer's teams`);
  }

  world();
  await getPlayerUpcomingMatches('viewer');
  assert.deepEqual(callsFor('match', 'findMany')[0][0].where.teamId, { in: ['A'] }, "upcoming: team B's schedule is not shown");

  console.log('playerPortalScope.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
