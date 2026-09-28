// The home page's team cards (Phase 4.5) show each team's next match from
// /coach/dashboard's upcomingMatches. A global "5 soonest" list starved teams
// whose next match wasn't among them, so it's now the soonest match PER team.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { getCoachUpcomingMatches } from '../services/coachPortal.service';

async function main() {
  resetDb();
  db.team.findMany = async () => [{ id: 'A' }];
  db.teamMembership.findMany = async () => [{ teamId: 'B' }];
  db.match.findMany = async () => [];
  await getCoachUpcomingMatches('u');
  const args = callsFor('match', 'findMany')[0][0];
  assert.deepEqual(args.where.teamId, { in: ['A', 'B'] });
  assert.deepEqual(args.orderBy, { matchDate: 'asc' });
  assert.deepEqual(args.distinct, ['teamId'], 'one (the soonest) upcoming match per team');
  assert.equal(args.take, undefined, 'no global cap that could starve a team');
  console.log('coachUpcoming.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
