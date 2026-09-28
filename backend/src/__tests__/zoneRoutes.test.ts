// Court-zone maps (Phase 4). Match and team maps are team-level and go to every
// member (the visibility guard runs first, in the router). The player map uses
// resolvePlayerScope: that team's staff, an admin, or the player themself.
// Every query counts own-team, match events only, fetched without a zone
// filter so the map can report its coverage.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { getMatchZones, getTeamZones, getPlayerZones } from '../controllers/analytics';

const MEMBERS: Record<string, string> = { coach: 'HEAD_COACH', self: 'PLAYER', mate: 'PLAYER' };

function world() {
  resetDb();
  db.player.findUnique = async () => ({ id: 'p1', firstName: 'A', lastName: 'B', jerseyNumber: 1, position: 'SETTER', teamId: 'T', userId: 'self' });
  db.playerTeamLink.findUnique = async () => null;
  db.team.findUnique = async (args: any) => (args.where.id === 'T' ? { ownerId: 'nobody' } : null);
  db.user.findUnique = async () => ({ role: 'COACH' });
  db.teamMembership.findUnique = async (args: any) => {
    const role = args.where.userId_teamId.teamId === 'T' ? MEMBERS[args.where.userId_teamId.userId] : undefined;
    return role ? { id: 'm', role } : null;
  };
  db.match.findUnique = async (args: any) => ({ M: { teamId: 'T' }, ELSE: { teamId: 'X' } } as any)[args.where.id] ?? null;
  db.event.findMany = async () => [{ eventType: 'KILL', courtZone: 4 }, { eventType: 'KILL', courtZone: null }];
}

async function call(handler: any, userId: string | null, params: Record<string, string>, query: Record<string, string> = {}) {
  let body: any;
  let error: any;
  const res: any = { status: () => res, json: (b: any) => { body = b; return res; } };
  await handler({ params, query, user: userId ? { userId } : undefined } as any, res, (err: any) => { error = err; });
  return { status: error ? error.statusCode ?? 500 : 200, body };
}

const lastWhere = () => callsFor('event', 'findMany').at(-1)![0];

async function main() {
  world();
  const match = await call(getMatchZones, 'mate', { matchId: 'M' });
  assert.equal(match.body.attack['4'].kills, 1);
  assert.deepEqual(match.body.coverage, { tagged: 1, total: 2 });
  let q = lastWhere();
  assert.equal(q.where.matchId, 'M');
  assert.equal(q.where.isOpponentEvent, false);
  assert.equal(q.where.trainingSessionId, null);
  assert.equal(q.where.courtZone, undefined, 'no zone filter: coverage needs the untagged rows');
  assert.deepEqual(q.select, { courtZone: true, eventType: true });

  const team = await call(getTeamZones, 'mate', { teamId: 'T' });
  assert.equal(team.status, 200);
  q = lastWhere();
  assert.deepEqual(q.where.match, { teamId: 'T' });
  assert.equal(q.where.isOpponentEvent, false);

  // Player map: staff and self only; scoped to one team and optionally a match.
  world();
  assert.equal((await call(getPlayerZones, 'coach', { playerId: 'p1' })).status, 200);
  assert.deepEqual(lastWhere().where.match, { teamId: 'T' });
  assert.equal(lastWhere().where.playerId, 'p1');
  assert.equal(lastWhere().where.isOpponentEvent, false);
  assert.equal((await call(getPlayerZones, 'self', { playerId: 'p1' }, { matchId: 'M' })).status, 200);
  assert.equal(lastWhere().where.matchId, 'M');
  assert.equal((await call(getPlayerZones, 'mate', { playerId: 'p1' })).status, 403, "a teammate can't see a player's map");
  assert.equal((await call(getPlayerZones, 'outsider', { playerId: 'p1' })).status, 404);
  assert.equal((await call(getPlayerZones, null, { playerId: 'p1' })).status, 404);
  assert.equal((await call(getPlayerZones, 'coach', { playerId: 'p1' }, { matchId: 'ELSE' })).status, 404, "another team's match");

  console.log('zoneRoutes.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
