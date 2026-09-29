// 8.3: optional ?from=&to= on the seven cross-match analytics routes. The
// window lands in every event query's `match` clause, the team page's match
// counts use the same window, a bad date is a 400 (after the visibility
// guard: the router runs it first, and http.routing.test proves an outsider
// still gets 404), and object responses echo the range as `dateRange`.
// With no params every route behaves exactly as before.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import {
  getTeamAnalytics, getTeamTrends, getTeamZones, getTeamRotations, getTeamAdvanced,
  getPlayerAnalytics, getPlayerZones,
} from '../controllers/analytics';

const SEPT = { gte: new Date('2026-09-01T00:00:00.000Z'), lt: new Date('2026-10-01T00:00:00.000Z') };
const RANGE = { from: '2026-09-01', to: '2026-09-30' };

function world() {
  resetDb();
  db.team.findUnique = async (args: any) => ({
    id: 'T', name: 'Falcons', division: null, season: '2026', ownerId: 'coach',
    players: [{ id: 'p1', firstName: 'Ann', lastName: 'A', jerseyNumber: 1, position: 'SETTER', teamId: 'T', userId: 'ann' }],
    matches: args?.include?.matches ? [{ id: 'm1', status: 'COMPLETED', setScores: [] }] : undefined,
  });
  db.teamMembership.findUnique = async () => null; // 'coach' is the owner
  db.user.findUnique = async () => ({ role: 'COACH' });
  db.event.findMany = async () => [];
  db.match.findMany = async () => [];
  db.match.findUnique = async () => ({ teamId: 'T' });
  db.player.findUnique = async () => ({ id: 'p1', firstName: 'Ann', lastName: 'A', jerseyNumber: 1, position: 'SETTER', teamId: 'T', userId: 'ann' });
  db.playerTeamLink.findUnique = async () => null;
}

async function call(handler: any, params: Record<string, string>, query: Record<string, unknown>) {
  world();
  let body: any;
  let error: any;
  const res: any = { status: () => res, json: (b: any) => { body = b; return res; }, locals: { visibleTeamId: 'T' } };
  await handler({ params, query, user: { userId: 'coach' } } as any, res, (err: any) => { error = err; });
  return { body, error, eventWheres: callsFor('event', 'findMany').map((c) => c[0].where) };
}

const TEAM_ROUTES: [string, any][] = [
  ['team', getTeamAnalytics], ['zones', getTeamZones], ['rotations', getTeamRotations], ['advanced', getTeamAdvanced],
];
const PLAYER_ROUTES: [string, any][] = [['player', getPlayerAnalytics], ['player zones', getPlayerZones]];

async function main() {
  // No range: queries and responses as before, plus dateRange: null.
  for (const [name, handler] of TEAM_ROUTES) {
    const r = await call(handler, { teamId: 'T' }, {});
    assert.equal(r.error, undefined, name);
    assert.ok(r.eventWheres.length > 0, name);
    for (const w of r.eventWheres) assert.deepEqual(w.match, { teamId: 'T' }, `${name}: no window`);
    assert.equal(r.body.dateRange, null, `${name}: dateRange null`);
  }

  // A range: in every event query, echoed back.
  for (const [name, handler] of TEAM_ROUTES) {
    const r = await call(handler, { teamId: 'T' }, RANGE);
    assert.equal(r.error, undefined, name);
    for (const w of r.eventWheres) assert.deepEqual(w.match, { teamId: 'T', matchDate: SEPT }, `${name}: window in the where`);
    assert.deepEqual(r.body.dateRange, { from: '2026-09-01', to: '2026-09-30' }, `${name}: echoed`);
  }

  // Team page: the match counts use the same window, and matchSummary gets
  // no new keys (the page renders each key as a card).
  {
    const r = await call(getTeamAnalytics, { teamId: 'T' }, RANGE);
    const teamCall = callsFor('team', 'findUnique').find((c) => c[0].include?.matches)![0];
    assert.deepEqual(teamCall.include.matches.where, { matchDate: SEPT });
    assert.deepEqual(Object.keys(r.body.matchSummary), ['total', 'completed', 'inProgress', 'scheduled']);
  }

  // One side only.
  {
    const r = await call(getTeamZones, { teamId: 'T' }, { from: '2026-09-01' });
    assert.deepEqual(r.eventWheres[0].match, { teamId: 'T', matchDate: { gte: SEPT.gte } });
    assert.deepEqual(r.body.dateRange, { from: '2026-09-01', to: null });
  }

  // Trends: completed matches in the window; still a bare array (installed
  // apps read it as one).
  {
    const r = await call(getTeamTrends, { teamId: 'T' }, RANGE);
    assert.equal(r.error, undefined);
    assert.deepEqual(callsFor('match', 'findMany')[0][0].where, { teamId: 'T', status: 'COMPLETED', matchDate: SEPT });
    assert.ok(Array.isArray(r.body));
    const none = await call(getTeamTrends, { teamId: 'T' }, {});
    assert.deepEqual(callsFor('match', 'findMany')[0][0].where, { teamId: 'T', status: 'COMPLETED' });
    assert.ok(Array.isArray(none.body));
  }

  // Player routes: the window applies across matches...
  for (const [name, handler] of PLAYER_ROUTES) {
    const r = await call(handler, { playerId: 'p1' }, RANGE);
    assert.equal(r.error, undefined, name);
    assert.deepEqual(r.eventWheres[0].match, { teamId: 'T', matchDate: SEPT }, name);
    assert.deepEqual(r.body.dateRange, { from: '2026-09-01', to: '2026-09-30' }, name);
  }
  // ...but a matchId wins: from/to aren't even parsed.
  for (const [name, handler] of PLAYER_ROUTES) {
    const r = await call(handler, { playerId: 'p1' }, { matchId: 'm1', from: 'garbage' });
    assert.equal(r.error, undefined, `${name}: matchId wins`);
    assert.deepEqual(r.eventWheres[0].match, { teamId: 'T' }, name);
    assert.equal(r.eventWheres[0].matchId, 'm1');
    assert.equal(r.body.dateRange, null, name);
  }

  // A bad date is a 400 with the message, on every route.
  for (const [name, handler, params] of [
    ...TEAM_ROUTES.map(([n, h]) => [n, h, { teamId: 'T' }] as const),
    ['trends', getTeamTrends, { teamId: 'T' }] as const,
    ...PLAYER_ROUTES.map(([n, h]) => [n, h, { playerId: 'p1' }] as const),
  ]) {
    const r = await call(handler, params, { from: '2026-02-30' });
    assert.equal(r.error?.statusCode, 400, name);
    assert.equal(r.error?.message, 'Dates must look like 2026-09-30.', name);
    assert.equal(callsFor('event', 'findMany').length, 0, `${name}: no events read`);
  }

  console.log('analyticsDateRange: all tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
