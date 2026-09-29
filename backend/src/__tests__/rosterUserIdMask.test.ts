// 8.0.4: roster rows carry Player.userId, an internal account id. Staff (and
// admins) still get every id; anyone else gets their own and null for the
// rest. The field stays present, so installed apps don't break, and the team
// page can still find "you" by userId.
import assert from 'node:assert/strict';
import { db, resetDb } from '../testing/installFakePrisma';
import { getMatch } from '../controllers/matches';
import { getTeam } from '../controllers/teams';
import { getPlayersByTeam, getPlayer } from '../controllers/players';

const ROLES: Record<string, string> = { coach: 'HEAD_COACH', ann: 'PLAYER', viewer: 'VIEWER' };
const PLAYERS = [
  { id: 'p1', firstName: 'Ann', lastName: 'A', jerseyNumber: 1, teamId: 'T', userId: 'ann' },
  { id: 'p2', firstName: 'Ben', lastName: 'B', jerseyNumber: 2, teamId: 'T', userId: 'ben' },
  { id: 'p3', firstName: 'Cat', lastName: 'C', jerseyNumber: 3, teamId: 'T', userId: null },
];

function world() {
  resetDb();
  db.teamMembership.findUnique = async (args: any) => {
    const role = ROLES[args.where.userId_teamId.userId];
    return role ? { id: 'm', role } : null;
  };
  db.team.findUnique = async (args: any) =>
    (args.select && !args.include ? { ownerId: 'owner' } : { id: 'T', name: 'Falcons', ownerId: 'owner', players: PLAYERS, matches: [] });
  db.user.findUnique = async (args: any) => ({ role: args.where.id === 'admin' ? 'ADMIN' : 'COACH' });
  db.match.findUnique = async () => ({ id: 'M', teamId: 'T', team: { id: 'T', name: 'Falcons', players: PLAYERS }, _count: { events: 0, scoreAdjustments: 0 } });
  db.player.findMany = async () => PLAYERS;
  db.player.findUnique = async (args: any) => ({ ...PLAYERS.find((p) => p.id === args.where.id)!, team: { id: 'T', name: 'Falcons' } });
}

async function call(handler: any, userId: string | null, params: Record<string, string>) {
  let body: any;
  let error: any;
  const res: any = { status: () => res, json: (b: any) => { body = b; return res; }, locals: { visibleTeamId: 'T' } };
  await handler({ params, query: {}, user: userId ? { userId } : undefined } as any, res, (err: any) => { error = err; });
  if (error) throw error;
  return body;
}

const userIds = (rows: any[]) => rows.map((p) => [p.id, p.userId]);
const ALL = [['p1', 'ann'], ['p2', 'ben'], ['p3', null]];

async function main() {
  const rosters: [string, any, Record<string, string>, (b: any) => any[]][] = [
    ['GET /matches/:id', getMatch, { id: 'M' }, (b) => b.team.players],
    ['GET /teams/:id', getTeam, { id: 'T' }, (b) => b.players],
    ['GET /players/by-team/:teamId', getPlayersByTeam, { teamId: 'T' }, (b) => b],
  ];
  for (const [name, handler, params, rows] of rosters) {
    world();
    assert.deepEqual(userIds(rows(await call(handler, 'coach', params))), ALL, `${name}: staff see every id`);
    assert.deepEqual(userIds(rows(await call(handler, 'admin', params))), ALL, `${name}: admin sees every id`);
    assert.deepEqual(userIds(rows(await call(handler, 'ann', params))), [['p1', 'ann'], ['p2', null], ['p3', null]], `${name}: a player sees only their own id`);
    assert.deepEqual(userIds(rows(await call(handler, 'viewer', params))), [['p1', null], ['p2', null], ['p3', null]], `${name}: a viewer sees none`);
    const annRows = rows(await call(handler, 'ann', params));
    assert.equal(annRows.length, 3, `${name}: no rows dropped`);
    assert.ok(annRows.every((p: any) => 'userId' in p), `${name}: the field stays present`);
  }

  world();
  assert.equal((await call(getPlayer, 'coach', { id: 'p2' })).userId, 'ben', 'GET /players/:id: staff');
  assert.equal((await call(getPlayer, 'ann', { id: 'p2' })).userId, null, 'GET /players/:id: someone else\'s record');
  assert.equal((await call(getPlayer, 'ann', { id: 'p1' })).userId, 'ann', 'GET /players/:id: your own record');

  console.log('rosterUserIdMask: all tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
