// The single place authorization expectations live: every team-scoped route,
// called by an outsider (a coach of another team), a VIEWER and a PLAYER of
// the team. Target behaviour: outsiders get 404 (team ids never leak), members
// get 403 on anything their role can't do.
//
// Phase 1 recorded today's gaps here as TODO(P2) rows; Phase 2 closed every
// one (visibility first in every guard), so each row is now a real assertion.
// A few role-specific checks for the Phase 2 fixes follow the table.
//
// AUTHZ_RECORD=1 prints every observed status instead of asserting.
import assert from 'node:assert/strict';
import { prisma, startApp, makeUser, makeTeam, addMember, cleanup, call, TestUser, RUN } from './harness';
import { generateTeamJoinCode } from '../services/teamJoinCode.service';

type Who = 'outsider' | 'viewer' | 'player';
type Statuses = Record<Who, number>;
type Fixtures = Awaited<ReturnType<typeof setup>>;
type Row = {
  name: string;
  method: string;
  path: (f: Fixtures) => string;
  body?: (f: Fixtures) => unknown;
  expect: Statuses;
};

const READ: Statuses = { outsider: 404, viewer: 200, player: 200 };
const STAFF: Statuses = { outsider: 404, viewer: 403, player: 403 };
const SELF: Statuses = { outsider: 200, viewer: 200, player: 200 };

async function setup() {
  const owner = await makeUser('owner');
  const outsider = await makeUser('outsider');
  const viewer = await makeUser('viewer');
  const player = await makeUser('player');
  const stat = await makeUser('stat');
  const assistant = await makeUser('assistant');
  const manager = await makeUser('manager');
  const team = await makeTeam(owner, 'Authz A');
  await makeTeam(outsider, 'Authz B');
  await addMember(team.id, viewer, 'VIEWER');
  await addMember(team.id, player, 'PLAYER');
  const statMembership = await addMember(team.id, stat, 'STATISTICIAN');
  await addMember(team.id, assistant, 'ASSISTANT_COACH'); // APPROVAL_REQUIRED on invitations by default
  await addMember(team.id, manager, 'MANAGER');
  const staffCode = await generateTeamJoinCode('STAFF');
  await prisma.team.update({ where: { id: team.id }, data: { staffJoinCode: staffCode } });

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
  // Addressed to none of the three callers: accept/decline must refuse them.
  const invitee = await makeUser('invitee');
  const invitation = await prisma.invitation.create({
    data: { email: invitee.email, teamId: team.id, invitedById: owner.id, role: 'PLAYER', token: `${RUN}-token`, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  const feedback = await prisma.feedback.create({
    data: { userId: owner.id, type: 'BUG', subject: 'x', description: 'x', attachments: { create: { kind: 'FILE', storagePath: 'x/y.pdf', originalName: 'y.pdf', mimeType: 'application/pdf', sizeBytes: 1 } } },
    include: { attachments: true },
  });
  return { invitation, feedback, team, owner, assistant, manager, staffCode, users: { outsider, viewer, player } as Record<Who, TestUser>, statMembership, p1, p2, pDel, match, matchDel, event, channel, message, approval };
}

const ROWS: Row[] = [
  // ── Team reads ──
  { name: 'GET team', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}`, expect: READ },
  { name: 'GET team owner', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/owner`, expect: READ },
  { name: 'GET team members', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/members`, expect: READ },
  { name: 'GET my-role', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/my-role`, expect: READ },
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
  // Court-zone maps (Phase 4): team maps for every member; a player's map for staff and the player.
  { name: 'GET match zones', method: 'GET', path: (f) => `/api/v1/analytics/matches/${f.match.id}/zones`, expect: READ },
  { name: 'GET team zones', method: 'GET', path: (f) => `/api/v1/analytics/teams/${f.team.id}/zones`, expect: READ },
  { name: 'GET player zones (someone else)', method: 'GET', path: (f) => `/api/v1/analytics/players/${f.p1.id}/zones`, expect: STAFF },
  { name: 'GET player zones (own record)', method: 'GET', path: (f) => `/api/v1/analytics/players/${f.p2.id}/zones`, expect: { outsider: 404, viewer: 403, player: 200 } },
  { name: 'GET team channel', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/channel`, expect: READ },
  { name: 'GET channel messages', method: 'GET', path: (f) => `/api/v1/channels/${f.channel.id}/messages`, expect: READ },

  // ── Not team-scoped (4.0.8): the caller's own data, or a secret in the URL ──
  // Self-scoped: every signed-in caller gets their own (team-level) data.
  { name: 'GET player portal dashboard', method: 'GET', path: () => '/api/v1/player/dashboard', expect: SELF },
  { name: 'GET player portal stats', method: 'GET', path: () => '/api/v1/player/stats', expect: SELF },
  { name: 'GET player portal bests', method: 'GET', path: () => '/api/v1/player/bests', expect: SELF },
  { name: 'GET player portal teams', method: 'GET', path: () => '/api/v1/player/teams', expect: SELF },
  { name: 'GET coach portal dashboard', method: 'GET', path: () => '/api/v1/coach/dashboard', expect: SELF },
  { name: 'GET coach portal teams', method: 'GET', path: () => '/api/v1/coach/teams', expect: SELF },
  { name: 'GET coach portal stats', method: 'GET', path: () => '/api/v1/coach/stats', expect: SELF },
  { name: 'GET my teams', method: 'GET', path: () => '/api/v1/users/me/teams', expect: SELF },
  { name: 'GET my invitations', method: 'GET', path: () => '/api/v1/users/me/invitations', expect: SELF },
  // A join code is the secret: anyone holding it may look it up (that's how joining works).
  { name: 'GET join-code lookup', method: 'GET', path: (f) => `/api/v1/invitations/lookup/${f.staffCode}`, expect: SELF },
  // An unknown code answers 200 { kind: null }, not 404 (rate-limited by joinCodeRateLimit).
  { name: 'GET join-code lookup (unknown)', method: 'GET', path: () => '/api/v1/invitations/lookup/NOSUCHCODE', expect: SELF },
  { name: 'POST redeem (unknown token)', method: 'POST', path: () => '/api/v1/invitations/redeem', body: () => ({ code: 'NOSUCHCODE' }), expect: { outsider: 404, viewer: 404, player: 404 } },
  { name: 'POST redeem team code (unknown)', method: 'POST', path: () => '/api/v1/invitations/redeem-team-code', body: () => ({ code: 'NOSUCHCODE' }), expect: { outsider: 404, viewer: 404, player: 404 } },
  // Someone else's invitation: the email must match the caller's.
  { name: "POST accept someone's invitation", method: 'POST', path: (f) => `/api/v1/invitations/${f.invitation.token}/accept`, expect: { outsider: 403, viewer: 403, player: 403 } },
  { name: "POST decline someone's invitation", method: 'POST', path: (f) => `/api/v1/invitations/${f.invitation.token}/decline`, expect: { outsider: 403, viewer: 403, player: 403 } },
  // The owner's feedback attachment. 403, not 404: the ids are unguessable cuids.
  { name: "GET someone's feedback attachment", method: 'GET', path: (f) => `/api/v1/feedback/${f.feedback.id}/attachments/${f.feedback.attachments[0].id}/url`, expect: { outsider: 403, viewer: 403, player: 403 } },

  // ── Staff-only reads ──
  { name: 'GET team invitations', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/invitations`, expect: STAFF },
  { name: 'GET join codes', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/join-codes`, expect: STAFF },
  { name: 'GET approval requests', method: 'GET', path: (f) => `/api/v1/teams/${f.team.id}/approval-requests`, expect: STAFF },

  // ── Writes ──
  { name: 'PATCH team', method: 'PATCH', path: (f) => `/api/v1/teams/${f.team.id}`, body: () => ({ name: 'Hijacked' }), expect: STAFF },
  { name: 'POST transfer', method: 'POST', path: (f) => `/api/v1/teams/${f.team.id}/transfer`, body: (f) => ({ email: f.owner.email }), expect: STAFF },
  { name: 'PATCH member', method: 'PATCH', path: (f) => `/api/v1/teams/${f.team.id}/members/${f.statMembership.id}`, body: () => ({ role: 'PLAYER' }), expect: STAFF },
  { name: 'POST invitation', method: 'POST', path: (f) => `/api/v1/teams/${f.team.id}/invitations`, body: () => ({ email: 'nobody@integration.test', role: 'PLAYER' }), expect: STAFF },
  { name: 'POST regenerate join codes', method: 'POST', path: (f) => `/api/v1/teams/${f.team.id}/join-codes/regenerate`, body: () => ({ kind: 'player' }), expect: STAFF },
  { name: 'POST match', method: 'POST', path: () => '/api/v1/matches', body: (f) => ({ teamId: f.team.id, opponent: 'X', matchDate: new Date().toISOString() }), expect: STAFF },
  { name: 'PATCH match', method: 'PATCH', path: (f) => `/api/v1/matches/${f.match.id}`, body: () => ({ opponent: 'Y' }), expect: STAFF },
  { name: 'PATCH match score', method: 'PATCH', path: (f) => `/api/v1/matches/${f.match.id}/score`, body: () => ({ homeScore: 1, awayScore: 0 }), expect: STAFF },
  { name: 'POST reset set score', method: 'POST', path: (f) => `/api/v1/matches/${f.match.id}/score/reset`, expect: STAFF },
  { name: 'POST reset match', method: 'POST', path: (f) => `/api/v1/matches/${f.match.id}/score/reset-match`, expect: STAFF },
  { name: 'POST player', method: 'POST', path: () => '/api/v1/players', body: (f) => ({ teamId: f.team.id, firstName: 'N', lastName: 'N', jerseyNumber: 99, position: 'SETTER' }), expect: STAFF },
  { name: 'PATCH player', method: 'PATCH', path: (f) => `/api/v1/players/${f.p1.id}`, body: () => ({ firstName: 'Z' }), expect: STAFF },
  { name: 'POST player team link', method: 'POST', path: (f) => `/api/v1/players/${f.p1.id}/team-links`, body: (f) => ({ teamId: f.team.id }), expect: STAFF },
  { name: 'DELETE player team link', method: 'DELETE', path: (f) => `/api/v1/players/${f.p1.id}/team-links/${f.team.id}`, expect: STAFF },
  { name: 'POST event', method: 'POST', path: () => '/api/v1/events', body: (f) => ({ matchId: f.match.id, playerId: f.p1.id, eventType: 'KILL', setNumber: 1 }), expect: STAFF },
  { name: 'POST chat message', method: 'POST', path: (f) => `/api/v1/channels/${f.channel.id}/messages`, body: () => ({ body: 'hi' }), expect: { outsider: 404, viewer: 403, player: 201 } },
  // No files attached: the permission guard runs before multer, so a caller who
  // passes it gets 400 for the empty upload, and one who doesn't never gets there.
  { name: 'POST chat upload (no files)', method: 'POST', path: (f) => `/api/v1/channels/${f.channel.id}/messages/upload`, body: () => ({}), expect: { outsider: 404, viewer: 403, player: 400 } },
  { name: 'PATCH message (not author)', method: 'PATCH', path: (f) => `/api/v1/messages/${f.message.id}`, body: () => ({ body: 'edited' }), expect: STAFF },
  { name: 'DELETE message (not author)', method: 'DELETE', path: (f) => `/api/v1/messages/${f.message.id}`, expect: STAFF },
  // 4.0.2: players no longer claim records; staff link them on the roster.
  { name: 'POST self-claim record', method: 'POST', path: () => '/api/v1/player/link', body: (f) => ({ playerId: f.p1.id }), expect: { outsider: 403, viewer: 403, player: 403 } },
  { name: 'DELETE self-unlink record', method: 'DELETE', path: (f) => `/api/v1/player/link/${f.p2.id}`, expect: { outsider: 403, viewer: 403, player: 403 } },
  { name: 'POST staff link record', method: 'POST', path: (f) => `/api/v1/teams/${f.team.id}/players/${f.p1.id}/link`, body: (f) => ({ userId: f.users.viewer.id }), expect: STAFF },
  { name: 'DELETE staff unlink record', method: 'DELETE', path: (f) => `/api/v1/teams/${f.team.id}/players/${f.p2.id}/link`, expect: STAFF },
  { name: 'POST approve request', method: 'POST', path: (f) => `/api/v1/approval-requests/${f.approval.id}/approve`, expect: STAFF },
  { name: 'POST reject request', method: 'POST', path: (f) => `/api/v1/approval-requests/${f.approval.id}/reject`, expect: STAFF },
  // Destructive rows last, each against a target nothing else uses.
  { name: 'DELETE event (undo last)', method: 'DELETE', path: (f) => `/api/v1/events/undo/${f.match.id}`, expect: STAFF },
  { name: 'DELETE event', method: 'DELETE', path: (f) => `/api/v1/events/${f.event.id}`, expect: STAFF },
  { name: 'DELETE player', method: 'DELETE', path: (f) => `/api/v1/players/${f.pDel.id}`, expect: STAFF },
  { name: 'DELETE match', method: 'DELETE', path: (f) => `/api/v1/matches/${f.matchDel.id}`, expect: STAFF },
  { name: 'DELETE member', method: 'DELETE', path: (f) => `/api/v1/teams/${f.team.id}/members/${f.statMembership.id}`, expect: STAFF },
  { name: 'DELETE team', method: 'DELETE', path: (f) => `/api/v1/teams/${f.team.id}`, expect: STAFF },
];

async function main() {
  const { base, close } = await startApp();
  const record = process.env.AUTHZ_RECORD === '1';
  const failures: string[] = [];
  try {
    const f = await setup();

    // Members without MANAGE_MEMBERS must not see anyone's email.
    for (const who of ['viewer', 'player'] as const) {
      const res = await call(base, 'GET', `/api/v1/teams/${f.team.id}/members`, f.users[who].token);
      assert.equal(res.status, 200);
      assert.ok(!JSON.stringify(res.body).includes('@integration.test'), `${who} saw member emails`);
    }

    // P2.1: below FULL_ACCESS on invitations, the staff code isn't returned...
    const codes = await call(base, 'GET', `/api/v1/teams/${f.team.id}/join-codes`, f.assistant.token);
    assert.equal(codes.status, 200);
    assert.ok(!('staffJoinCode' in codes.body), 'an assistant must not see the staff code');
    // ...and the staff code can't make anyone a MANAGER.
    const redeem = await call(base, 'POST', '/api/v1/invitations/redeem-team-code', f.users.outsider.token, { code: f.staffCode, role: 'MANAGER' });
    assert.equal(redeem.status, 400, 'a staff code must not grant MANAGER');
    // P2.2: a manager can't delete the team (the owner can; see http.teamDelete).
    assert.equal((await call(base, 'DELETE', `/api/v1/teams/${f.team.id}`, f.manager.token)).status, 403);

    // Phase 4.5: anyone can create a team (signupIntent no longer gates it),
    // capped at 5 owned teams, and the cap holds under parallel creates.
    const newTeam = (u: TestUser) => call(base, 'POST', '/api/v1/teams', u.token, { name: `${RUN} new`, season: '2026' });
    const playerIntent = await makeUser('intent-player');
    await prisma.user.update({ where: { id: playerIntent.id }, data: { signupIntent: 'PLAYER' } });
    assert.equal((await newTeam(playerIntent)).status, 201, 'a player-intent account can create a team');
    const racer = await makeUser('racer');
    for (let i = 0; i < 4; i++) await makeTeam(racer, `Racer ${i}`);
    const raced = await Promise.all([newTeam(racer), newTeam(racer)]);
    assert.deepEqual(raced.map((r) => r.status).sort(), [201, 409], 'two parallel creates at 4 teams: one wins, one is refused');
    assert.equal(await prisma.team.count({ where: { ownerId: racer.id } }), 5);
    assert.equal((await newTeam(racer)).status, 409, 'the 6th owned team is refused');

    // No token: team-scoped reads are 404 (no public teams), everything else 401.
    for (const [path, expected] of [
      [`/api/v1/teams/${f.team.id}`, 404],
      [`/api/v1/analytics/matches/${f.match.id}`, 404],
      [`/api/v1/events/by-match/${f.match.id}`, 404],
      ['/api/v1/users/me/teams', 401],
      ['/api/v1/player/dashboard', 401],
    ] as const) {
      assert.equal((await call(base, 'GET', path)).status, expected, `anonymous GET ${path}`);
    }
    assert.equal((await call(base, 'POST', '/api/v1/events', undefined, { matchId: f.match.id })).status, 401, 'anonymous POST event');

    // 4.0.1 per-player rule: non-staff get team totals plus only their own row.
    // p2 is the test player's record; p1 (who has the event) and pDel are other players.
    const perPlayer = [
      `/api/v1/analytics/matches/${f.match.id}`,
      `/api/v1/analytics/teams/${f.team.id}`,
      `/api/v1/analytics/matches/${f.match.id}/report`,
      `/api/v1/events/by-match/${f.match.id}`,
    ];
    const staffView = await call(base, 'GET', perPlayer[0], f.owner.token);
    assert.equal(staffView.body.playerStats.length, 3, 'staff see every player');
    for (const who of ['viewer', 'player'] as const) {
      for (const path of perPlayer) {
        const res = await call(base, 'GET', path, f.users[who].token);
        assert.equal(res.status, 200, `${path} as ${who}`);
        const text = JSON.stringify(res.body);
        assert.ok(!text.includes(f.p1.id) && !text.includes(f.pDel.id), `${path} as ${who} named another player`);
        assert.ok(!text.includes('"userId"'), `${path} as ${who} carried a userId`);
        if ('playerStats' in res.body) {
          assert.equal(res.body.playerStats.length, who === 'player' ? 1 : 0, `${path} as ${who}: own row only`);
        }
        if ('topPerformer' in res.body) assert.equal(res.body.topPerformer, null, `${path} as ${who}: no top performer`);
      }
    }

    for (const row of ROWS) {
      for (const who of ['outsider', 'viewer', 'player'] as const) {
        const res = await call(base, row.method, row.path(f), f.users[who].token, row.body?.(f));
        const expected = row.expect[who];
        if (record) {
          console.log(`${row.method.padEnd(6)} ${row.name.padEnd(36)} ${who.padEnd(8)} ${res.status}${res.status === row.expect[who] ? '' : `  (target ${row.expect[who]})`}`);
          continue;
        }
        if (res.status !== expected) failures.push(`${row.name} as ${who}: got ${res.status}, expected ${expected}`);
      }
    }
  } finally {
    await close();
    await cleanup();
  }
  if (record) return;
  assert.deepEqual(failures, [], `authz matrix mismatches:\n${failures.join('\n')}`);
  console.log(`authz-matrix passed (${ROWS.length} routes x 3 callers, plus role checks).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
