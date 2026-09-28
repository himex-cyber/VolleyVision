// Per-player data rule on the dashboards, the match report and the event log
// (v9.8.0; v9.6.0 covered only GET /analytics/players/:id). Staff (TRACK_MATCH)
// and admins see every player; a player sees team totals plus their own row;
// a viewer sees team totals only. The server leaves the rows out.
import assert from 'node:assert/strict';
import { db, resetDb } from '../testing/installFakePrisma';
import { getMatchAnalytics, getTeamAnalytics, getMatchReport } from '../controllers/analytics';
import { getEventsByMatch } from '../controllers/events';

const ROLES: Record<string, string> = { coach: 'HEAD_COACH', stat: 'STATISTICIAN', ann: 'PLAYER', viewer: 'VIEWER' };
const PLAYERS = [
  { id: 'p1', firstName: 'Ann', lastName: 'A', jerseyNumber: 1, position: 'SETTER', teamId: 'T', userId: 'ann' },
  { id: 'p2', firstName: 'Ben', lastName: 'B', jerseyNumber: 2, position: 'LIBERO', teamId: 'T', userId: 'ben' },
];
const EVENTS = [
  { id: 'e1', eventType: 'KILL', playerId: 'p1', setNumber: 1, courtZone: 4, rotationNumber: 1, recordedAt: new Date(1), notes: 'ann note', isOpponentEvent: false, player: { firstName: 'Ann', lastName: 'A', jerseyNumber: 1, userId: 'ann' } },
  { id: 'e2', eventType: 'ACE', playerId: 'p2', setNumber: 1, courtZone: 1, rotationNumber: 1, recordedAt: new Date(2), notes: 'ben note', isOpponentEvent: false, player: { firstName: 'Ben', lastName: 'B', jerseyNumber: 2, userId: 'ben' } },
  { id: 'e3', eventType: 'KILL', playerId: null, setNumber: 1, courtZone: null, rotationNumber: 1, recordedAt: new Date(3), notes: null, isOpponentEvent: true, player: null },
];

function world() {
  resetDb();
  const team = { id: 'T', name: 'Falcons', division: null, season: null, ownerId: 'owner', players: PLAYERS, matches: [] };
  db.team.findUnique = async () => team;
  db.teamMembership.findUnique = async (args: any) => {
    const role = ROLES[args.where.userId_teamId.userId];
    return role ? { id: 'm', role } : null;
  };
  db.user.findUnique = async (args: any) => ({ role: args.where.id === 'admin' ? 'ADMIN' : 'COACH' });
  db.match.findUnique = async () => ({
    id: 'M', teamId: 'T', opponent: 'Wolves', homeSetsWon: 3, awaySetsWon: 1, setScores: [],
    team: { name: 'Falcons', players: PLAYERS }, events: EVENTS,
  });
  db.event.findMany = async () => EVENTS;
  db.player.findMany = async () => PLAYERS;
}

async function call(handler: any, userId: string, params: Record<string, string>) {
  let body: any;
  let error: any;
  // locals.visibleTeamId is what visibleByMatchParam hands on in the real app.
  const res: any = { status: () => res, json: (b: any) => { body = b; return res; }, locals: { visibleTeamId: 'T' } };
  await handler({ params, query: {}, user: { userId } } as any, res, (err: any) => { error = err; });
  if (error) throw error;
  return body;
}

const ids = (rows: any[]) => rows.map((r) => r.player.id);

async function main() {
  for (const [name, handler, params] of [
    ['match', getMatchAnalytics, { matchId: 'M' }],
    ['team', getTeamAnalytics, { teamId: 'T' }],
  ] as const) {
    world();
    const coach = await call(handler, 'coach', params);
    assert.deepEqual(ids(coach.playerStats).sort(), ['p1', 'p2'], `${name}: staff see all`);
    assert.deepEqual(ids((await call(handler, 'stat', params)).playerStats).sort(), ['p1', 'p2'], `${name}: statistician is staff`);
    assert.deepEqual(ids((await call(handler, 'admin', params)).playerStats).sort(), ['p1', 'p2'], `${name}: admin sees all`);
    const ann = await call(handler, 'ann', params);
    assert.deepEqual(ids(ann.playerStats), ['p1'], `${name}: a player sees only their own row`);
    assert.ok(!JSON.stringify(ann).includes('Ben'), `${name}: no other player's name in the body`);
    assert.ok(!JSON.stringify(ann).includes('"userId"'), `${name}: userId never leaves the server`);
    assert.deepEqual(ann.teamStats, coach.teamStats, `${name}: team totals are the same for everyone`);
    assert.deepEqual((await call(handler, 'viewer', params)).playerStats, [], `${name}: a viewer sees no rows`);
  }

  world();
  assert.equal((await call(getMatchReport, 'coach', { matchId: 'M' })).topPerformer?.player.id !== undefined, true, 'report: staff get the top performer');
  const report = await call(getMatchReport, 'ann', { matchId: 'M' });
  assert.equal(report.topPerformer, null, 'report: non-staff get no top performer');
  assert.equal(report.attack.attempts, 2, 'report: team-level fields unchanged');
  assert.equal((await call(getMatchReport, 'viewer', { matchId: 'M' })).topPerformer, null);

  world();
  const full = await call(getEventsByMatch, 'coach', { matchId: 'M' });
  assert.equal(full[1].player.firstName, 'Ben', 'events: staff see who did it');
  assert.equal(full[1].notes, 'ben note');
  assert.ok(!JSON.stringify(full).includes('"userId"'));
  const mine = await call(getEventsByMatch, 'ann', { matchId: 'M' });
  assert.equal(mine[0].player.firstName, 'Ann', "events: the caller's own event is unchanged");
  assert.deepEqual([mine[1].playerId, mine[1].player, mine[1].notes], [null, null, null], "events: a teammate's event is anonymised");
  assert.equal(mine[1].courtZone, 1, 'events: zone/set/type kept');
  assert.equal(mine[2].isOpponentEvent, true, 'events: opponent events kept');
  const view = await call(getEventsByMatch, 'viewer', { matchId: 'M' });
  assert.ok(!JSON.stringify(view).includes('Ann') && !JSON.stringify(view).includes('Ben'), 'events: a viewer sees no names');

  console.log('playerPrivacyEndpoints.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
