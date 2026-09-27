// The single place authorization expectations live: every team-scoped route,
// called by an outsider (a coach of another team), a VIEWER and a PLAYER of
// the team. Target behaviour: outsiders get 404 (team ids never leak), members
// get 403 on anything their role can't do.
//
// `today` records where the app still differs from the target. Those rows are
// asserted at today's status, so they document the gap and catch accidental
// change, and are listed as TODO(P2). Phase 2 fixes each route and deletes
// its `today` entry, turning the row into a real assertion.
//
// AUTHZ_RECORD=1 prints every observed status instead of asserting.
import assert from 'node:assert/strict';
import { prisma, startApp, makeUser, makeTeam, addMember, cleanup, call, TestUser } from './harness';

type Who = 'outsider' | 'viewer' | 'player';
type Statuses = Record<Who, number>;
type Fixtures = Awaited<ReturnType<typeof setup>>;
type Row = {
  name: string;
  method: string;
  path: (f: Fixtures) => string;
  body?: (f: Fixtures) => unknown;
  expect: Statuses;
  today?: Partial<Statuses>;
};

const READ: Statuses = { outsider: 404, viewer: 200, player: 200 };
const STAFF: Statuses = { outsider: 404, viewer: 403, player: 403 };
// Most team-scoped guards check the role before visibility today, so an outsider
// learns the team exists. Phase 2 puts visibility first.
const OUTSIDER_403: Partial<Statuses> = { outsider: 403 };

async function setup() {
  const owner = await makeUser('owner');
  const outsider = await makeUser('outsider');
  const viewer = await makeUser('viewer');
  const player = await makeUser('player');
  const stat = await makeUser('stat');
  const team = await makeTeam(owner, 'Authz A');
  await makeTeam(outsider, 'Authz B');
  await addMember(team.id, viewer, 'VIEWER');
  await addMember(team.id, player, 'PLAYER');
  const statMembership = await addMember(team.id, stat, 'STATISTICIAN');

  const [p1, p2, pDel] = await Promise.all(
    [1, 2, 3].map((n) => prisma.player.create({ data: { teamId: team.id, firstName: 'P', lastName: `${n}`, jerseyNumber: n, position: 'SETTER' } })),
  );
  await prisma.player.update({ where: { id: p2.id }, data: { userId: player.id } });
  const match = await prisma.match.create({ data: { teamId: team.id, opponent: 'Opp', matchDate: new Date(), status: 'IN_PROGRESS' } });
  const matchDel = await prisma.match.create({ data: { teamId: team.id, opponent: 'Opp2', matchDate: new Date() } });
  const event = await prisma.event.create({ data: { matchId: match.id, playerId: p1.id, eventType: 'KILL', setNumber: 1 } });
  const channel = await prisma.channel.create({ data: { teamId: team.id, type: 'TEAM' } });
  const message = await prisma.message.create({ data: { channelId: channel.id, senderId: owner.id, body: 'hello' } });
  const approval = await prisma.approvalRequest.create({
    data: { teamId: team.id, requestedById: stat.id, action: 'MATCH_UPDATE', payload: { opponent: 'X' }, targetId: match.id },
  });
  return { team, owner, users: { outsider, viewer, player } as Record<Who, TestUser>, statMembership, p1, p2, pDel, match, matchDel, event, channel, message, approval };
}

const ROWS: Row[] = [
  // ── Team reads ──
  { name: 'GET team', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}`, expect: READ },
  { name: 'GET team owner', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/owner`, expect: READ },
  { name: 'GET team members', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/members`, expect: READ },
  { name: 'GET my-role', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/my-role`, expect: READ, today: { outsider: 200 } },
  { name: 'GET matches by team', method: 'GET', path: (f) => `/api/v1/matches/by-team/${f.team.id}`, expect: READ },
  { name: 'GET match', method: 'GET', path: (f) => `/api/v1/matches/${f.match.id}`, expect: READ },
  { name: 'GET players by team', method: 'GET', path: (f) => `/api/v1/players/by-team/${f.team.id}`, expect: READ },
  { name: 'GET player', method: 'GET', path: (f) => `/api/v1/players/${f.p1.id}`, expect: READ },
  { name: 'GET player teams', method: 'GET', path: (f) => `/api/v1/players/${f.p1.id}/teams`, expect: READ },
  { name: 'GET events by match', method: 'GET', path: (f) => `/api/v1/events/by-match/${f.match.id}`, expect: READ },
  { name: 'GET match analytics', method: 'GET', path: (f) => `/api/v1/analytics/matches/${f.match.id}`, expect: READ },
  { name: 'GET match report', method: 'GET', path: (f) => `/api/v1/analytics/matches/${f.match.id}/report`, expect: READ },
  { name: 'GET team analytics', method: 'GET', path: (f) => `/api/v1/analytics/teams/${f.team.id}`, expect: READ },
  { name: 'GET team trends', method: 'GET', path: (f) => `/api/v1/analytics/teams/${f.team.id}/trends`, expect: READ },
  // Individual stats: staff and the player themself only (Karlos, 28 Sept). p1 is not the test player's record.
  { name: 'GET player analytics (someone else)', method: 'GET', path: (f) => `/api/v1/analytics/players/${f.p1.id}`, expect: STAFF },
  { name: 'GET player analytics (own record)', method: 'GET', path: (f) => `/api/v1/analytics/players/${f.p2.id}`, expect: { outsider: 404, viewer: 403, player: 200 } },
  { name: 'GET team channel', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/channel`, expect: READ, today: OUTSIDER_403 },
  { name: 'GET channel messages', method: 'GET', path: (f) => `/api/v1/channels/${f.channel.id}/messages`, expect: READ, today: OUTSIDER_403 },

  // ── Staff-only reads ──
  { name: 'GET team invitations', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/invitations`, expect: STAFF, today: OUTSIDER_403 },
  { name: 'GET join codes', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/join-codes`, expect: STAFF, today: OUTSIDER_403 },
  { name: 'GET approval requests', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/approval-requests`, expect: STAFF, today: OUTSIDER_403 },

  // ── Writes ──
  { name: 'PATCH team', method: 'PATCH', path: (f) => `/api/v1/teams/${f.team.id}`, body: () => ({ name: 'Hijacked' }), expect: STAFF, today: OUTSIDER_403 },
  { name: 'POST transfer', method: 'POST', path: (f) => `/api/v1/teams/${f.team.id}/transfer`, body: (f) => ({ email: f.owner.email }), expect: STAFF, today: OUTSIDER_403 },
  { name: 'PATCH member', method: 'PATCH', path: (f) => `/api/v1/teams/${f.team.id}/members/${f.statMembership.id}`, body: () => ({ role: 'PLAYER' }), expect: STAFF, today: OUTSIDER_403 },
  { name: 'POST invitation', method: 'POST', path: (f) => `/api/v1/teams/${f.team.id}/invitations`, body: () => ({ email: 'nobody@integration.test', role: 'PLAYER' }), expect: STAFF, today: OUTSIDER_403 },
  { name: 'POST regenerate join codes', method: 'POST', path: (f) => `/api/v1/teams/${f.team.id}/join-codes/regenerate`, body: () => ({ kind: 'player' }), expect: STAFF, today: OUTSIDER_403 },
  { name: 'POST match', method: 'POST', path: () => '/api/v1/matches', body: (f) => ({ teamId: f.team.id, opponent: 'X', matchDate: new Date().toISOString() }), expect: STAFF, today: OUTSIDER_403 },
  { name: 'PATCH match', method: 'PATCH', path: (f) => `/api/v1/matches/${f.match.id}`, body: () => ({ opponent: 'Y' }), expect: STAFF, today: OUTSIDER_403 },
  { name: 'PATCH match score', method: 'PATCH', path: (f) => `/api/v1/matches/${f.match.id}/score`, body: () => ({ homeScore: 1, awayScore: 0 }), expect: STAFF, today: OUTSIDER_403 },
  { name: 'POST reset set score', method: 'POST', path: (f) => `/api/v1/matches/${f.match.id}/score/reset`, expect: STAFF, today: OUTSIDER_403 },
  { name: 'POST reset match', method: 'POST', path: (f) => `/api/v1/matches/${f.match.id}/score/reset-match`, expect: STAFF, today: OUTSIDER_403 },
  { name: 'POST player', method: 'POST', path: () => '/api/v1/players', body: (f) => ({ teamId: f.team.id, firstName: 'N', lastName: 'N', jerseyNumber: 99, position: 'SETTER' }), expect: STAFF, today: OUTSIDER_403 },
  { name: 'PATCH player', method: 'PATCH', path: (f) => `/api/v1/players/${f.p1.id}`, body: () => ({ firstName: 'Z' }), expect: STAFF, today: OUTSIDER_403 },
  { name: 'POST player team link', method: 'POST', path: (f) => `/api/v1/players/${f.p1.id}/team-links`, body: (f) => ({ teamId: f.team.id }), expect: STAFF },
  { name: 'DELETE player team link', method: 'DELETE', path: (f) => `/api/v1/players/${f.p1.id}/team-links/${f.team.id}`, expect: STAFF },
  { name: 'POST event', method: 'POST', path: () => '/api/v1/events', body: (f) => ({ matchId: f.match.id, playerId: f.p1.id, eventType: 'KILL', setNumber: 1 }), expect: STAFF, today: OUTSIDER_403 },
  { name: 'POST chat message', method: 'POST', path: (f) => `/api/v1/channels/${f.channel.id}/messages`, body: () => ({ body: 'hi' }), expect: { outsider: 404, viewer: 403, player: 201 }, today: OUTSIDER_403 },
  // No files attached: the permission guard runs before multer, so a caller who
  // passes it gets 400 for the empty upload, and one who doesn't never gets there.
  { name: 'POST chat upload (no files)', method: 'POST', path: (f) => `/api/v1/channels/${f.channel.id}/messages/upload`, body: () => ({}), expect: { outsider: 404, viewer: 403, player: 400 }, today: OUTSIDER_403 },
  { name: 'PATCH message (not author)', method: 'PATCH', path: (f) => `/api/v1/messages/${f.message.id}`, body: () => ({ body: 'edited' }), expect: STAFF, today: OUTSIDER_403 },
  { name: 'DELETE message (not author)', method: 'DELETE', path: (f) => `/api/v1/messages/${f.message.id}`, expect: STAFF, today: OUTSIDER_403 },
  { name: 'POST approve request', method: 'POST', path: (f) => `/api/v1/approval-requests/${f.approval.id}/approve`, expect: STAFF },
  { name: 'POST reject request', method: 'POST', path: (f) => `/api/v1/approval-requests/${f.approval.id}/reject`, expect: STAFF },
  // Destructive rows last, each against a target nothing else uses.
  { name: 'DELETE event (undo last)', method: 'DELETE', path: (f) => `/api/v1/events/undo/${f.match.id}`, expect: STAFF, today: OUTSIDER_403 },
  { name: 'DELETE event', method: 'DELETE', path: (f) => `/api/v1/events/${f.event.id}`, expect: STAFF, today: OUTSIDER_403 },
  { name: 'DELETE player', method: 'DELETE', path: (f) => `/api/v1/players/${f.pDel.id}`, expect: STAFF, today: OUTSIDER_403 },
  { name: 'DELETE match', method: 'DELETE', path: (f) => `/api/v1/matches/${f.matchDel.id}`, expect: STAFF, today: OUTSIDER_403 },
  { name: 'DELETE member', method: 'DELETE', path: (f) => `/api/v1/teams/${f.team.id}/members/${f.statMembership.id}`, expect: STAFF, today: OUTSIDER_403 },
  { name: 'DELETE team', method: 'DELETE', path: (f) => `/api/v1/teams/${f.team.id}`, expect: STAFF },
];

async function main() {
  const { base, close } = await startApp();
  const record = process.env.AUTHZ_RECORD === '1';
  const failures: string[] = [];
  const todo: string[] = [];
  try {
    const f = await setup();

    // Members without MANAGE_MEMBERS must not see anyone's email.
    for (const who of ['viewer', 'player'] as const) {
      const res = await call(base, 'GET', `/api/v1/teams/${f.team.id}/members`, f.users[who].token);
      assert.equal(res.status, 200);
      assert.ok(!JSON.stringify(res.body).includes('@integration.test'), `${who} saw member emails`);
    }

    for (const row of ROWS) {
      for (const who of ['outsider', 'viewer', 'player'] as const) {
        const res = await call(base, row.method, row.path(f), f.users[who].token, row.body?.(f));
        const expected = row.today?.[who] ?? row.expect[who];
        if (record) {
          console.log(`${row.method.padEnd(6)} ${row.name.padEnd(36)} ${who.padEnd(8)} ${res.status}${res.status === row.expect[who] ? '' : `  (target ${row.expect[who]})`}`);
          continue;
        }
        if (res.status !== expected) failures.push(`${row.name} as ${who}: got ${res.status}, expected ${expected}`);
        if (row.today?.[who] !== undefined) todo.push(`TODO(P2) ${row.name} as ${who}: today ${row.today[who]}, target ${row.expect[who]}`);
      }
    }
  } finally {
    await close();
    await cleanup();
  }
  if (record) return;
  if (todo.length) console.log(todo.join('\n'));
  assert.deepEqual(failures, [], `authz matrix mismatches:\n${failures.join('\n')}`);
  console.log(`authz-matrix passed (${ROWS.length} routes x 3 callers, ${todo.length} TODO(P2)).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
