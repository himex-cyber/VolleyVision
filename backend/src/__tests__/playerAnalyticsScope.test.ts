// Roadmap defect 6: GET /analytics/players/:id totalled the player's events
// from EVERY team they've played for, checked visibility on the home team
// only, and trusted ?matchId. Individual stats are now scoped to one team
// (?teamId, defaulting to the home team) and shown only to that team's staff
// (TRACK_MATCH), a global admin, or the player themself (Karlos, 28 Sept) -
// teammates and viewers see team-level views only. Players can be minors.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { getPlayerAnalytics } from '../controllers/analytics';

// Player p1: home team HOME, also linked to LINKED. Linked to user "self".
const MEMBERS: Record<string, Record<string, string>> = {
  HOME: { coach: 'HEAD_COACH', viewer: 'VIEWER', self: 'PLAYER', mate: 'PLAYER' },
  LINKED: { linkedCoach: 'ASSISTANT_COACH' },
};

function world() {
  resetDb();
  db.player.findUnique = async () => ({ id: 'p1', firstName: 'A', lastName: 'B', jerseyNumber: 1, position: 'SETTER', teamId: 'HOME', userId: 'self' });
  db.playerTeamLink.findUnique = async (args: any) => (args.where.playerId_teamId.teamId === 'LINKED' ? { playerId: 'p1', teamId: 'LINKED' } : null);
  db.team.findUnique = async (args: any) => (MEMBERS[args.where.id] ? { ownerId: 'nobody' } : null);
  db.user.findUnique = async (args: any) => ({ role: args.where.id === 'admin' ? 'ADMIN' : 'COACH' });
  db.teamMembership.findUnique = async (args: any) => {
    const { userId, teamId } = args.where.userId_teamId;
    const role = MEMBERS[teamId]?.[userId];
    return role ? { id: 'm', role } : null;
  };
  db.match.findUnique = async (args: any) => ({ OTHER_MATCH: { teamId: 'ELSEWHERE' }, HOME_MATCH: { teamId: 'HOME' } } as any)[args.where.id] ?? null;
  db.event.findMany = async () => [];
}

async function call(userId: string | null, query: Record<string, string> = {}) {
  let status = 200;
  let body: any;
  const res: any = { status: (s: number) => { status = s; return res; }, json: (b: any) => { body = b; return res; } };
  let error: any;
  await getPlayerAnalytics({ params: { playerId: 'p1' }, query, user: userId ? { userId } : undefined } as any, res, (err: any) => { error = err; });
  return { status: error ? error.statusCode ?? 500 : status, body };
}

async function main() {
  world();
  // Who may see individual stats.
  assert.equal((await call('coach')).status, 200, 'staff');
  assert.equal((await call('self')).status, 200, 'the player themself');
  assert.equal((await call('admin')).status, 200, 'global admin');
  assert.equal((await call('viewer')).status, 403, 'a viewer sees team views only');
  assert.equal((await call('mate')).status, 403, 'a teammate sees team views only');
  assert.equal((await call('outsider')).status, 404, 'an outsider gets not-found');
  assert.equal((await call(null)).status, 404, 'anonymous gets not-found');

  // Scoped to one team: events are filtered to that team's matches.
  world();
  const ok = await call('coach');
  assert.equal(ok.body.teamId, 'HOME', 'defaults to the home team');
  assert.equal(ok.body.player.userId, undefined, "the linked user's id is not part of the response");
  const where = callsFor('event', 'findMany')[0][0].where;
  assert.deepEqual(where.match, { teamId: 'HOME' }, 'events must be limited to the team in scope');
  assert.equal(where.isOpponentEvent, false);
  assert.equal(where.trainingSessionId, null);

  // A linked team's staff see the player's stats on THEIR team, even though the
  // home team is invisible to them.
  world();
  const linked = await call('linkedCoach', { teamId: 'LINKED' });
  assert.equal(linked.status, 200);
  assert.deepEqual(callsFor('event', 'findMany')[0][0].where.match, { teamId: 'LINKED' });
  assert.equal(linked.body.player.teamId, 'LINKED', "the home team's id must not leak to a linked team's staff");
  // ...but not via the home team.
  assert.equal((await call('linkedCoach')).status, 404);

  // The player must belong to the requested team.
  world();
  assert.equal((await call('coach', { teamId: 'ELSEWHERE' })).status, 404);

  // ?matchId must belong to the team in scope.
  world();
  assert.equal((await call('coach', { matchId: 'OTHER_MATCH' })).status, 404);
  assert.equal((await call('coach', { matchId: 'HOME_MATCH' })).status, 200);

  console.log('playerAnalyticsScope.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
