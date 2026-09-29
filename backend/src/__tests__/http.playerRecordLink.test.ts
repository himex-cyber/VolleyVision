// 4.0.2: a PLAYER-role member could claim ANY unclaimed record on their team
// (their first claim could be a teammate's, and the player portal then showed
// that teammate's full stats). Staff now assign records; players can't claim
// or unlink their own.
// 6.0.1: whoever is linked reads that record's stats as "self", so only a
// PLAYER-role member may be linked (Karlos, 29 Sept). 6.0.2: link and unlink
// are audit-logged.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { withServer, tokenFor, send } from '../testing/http';

const MEMBERS: Record<string, string> = { coach: 'HEAD_COACH', ann: 'PLAYER', newbie: 'PLAYER', viewer: 'VIEWER', asst: 'ASSISTANT_COACH' };
const PLAYERS: Record<string, { id: string; teamId: string; userId: string | null }> = {
  P1: { id: 'P1', teamId: 'T', userId: null },
  P2: { id: 'P2', teamId: 'T', userId: 'ann' },
  P3: { id: 'P3', teamId: 'OTHER', userId: null },
};

function world() {
  resetDb();
  db.user.findUnique = async () => ({ tokenVersion: 0, role: 'COACH', emailVerifiedAt: new Date() });
  db.team.findUnique = async (args: any) => (args.where.id === 'T' ? { id: 'T', ownerId: 'coach' } : null);
  db.teamMembership.findUnique = async (args: any) => {
    const { userId, teamId } = args.where.userId_teamId;
    return teamId === 'T' && MEMBERS[userId] ? { id: `m-${userId}`, role: MEMBERS[userId] } : null;
  };
  db.player.findUnique = async (args: any) => PLAYERS[args.where.id] ?? null;
  db.player.findUniqueOrThrow = async (args: any) => PLAYERS[args.where.id];
  db.player.findFirst = async (args: any) =>
    Object.values(PLAYERS).map((p) => ({ ...p, jerseyNumber: 2 })).find((p) => p.userId === args.where.userId && p.teamId === args.where.teamId && p.id !== args.where.NOT?.id) ?? null;
  db.player.update = async (args: any) => ({ ...PLAYERS[args.where.id], ...args.data });
  // Without this stub the fake throws synchronously, before logAudit's .catch.
  db.auditLog.create = async () => ({});
}

async function main() {
  await withServer(async (base) => {
    // Players can't claim or unlink.
    world();
    assert.equal(await send(base, 'POST', '/api/v1/player/link', tokenFor('newbie'), { playerId: 'P1' }), 403, 'a player cannot claim a record');
    assert.equal(await send(base, 'DELETE', '/api/v1/player/link/P2', tokenFor('ann')), 403, 'a player cannot unlink their own record');
    assert.equal(callsFor('player', 'update').length, 0);

    // Staff link and unlink.
    world();
    const link = (who: string, player: string, body: unknown = { userId: 'newbie' }) =>
      send(base, 'POST', `/api/v1/teams/T/players/${player}/link`, tokenFor(who), body);
    assert.equal(await link('coach', 'P1'), 200, 'staff link a member to an unclaimed record');
    assert.deepEqual(callsFor('player', 'update')[0][0], { where: { id: 'P1' }, data: { userId: 'newbie' } });
    assert.equal(await send(base, 'DELETE', '/api/v1/teams/T/players/P2/link', tokenFor('coach')), 200, 'staff unlink');
    assert.deepEqual(callsFor('player', 'update')[1][0].data, { userId: null });
    const audits = callsFor('auditLog', 'create').map((c: any) => c[0].data);
    assert.deepEqual(audits[0], { userId: 'coach', action: 'LINK_PLAYER', resource: 'player', resourceId: 'P1', meta: { teamId: 'T', userId: 'newbie' } });
    assert.deepEqual(audits[1], { userId: 'coach', action: 'UNLINK_PLAYER', resource: 'player', resourceId: 'P2', meta: { teamId: 'T', userId: 'ann' } }, 'unlink logs the previous holder');

    // Refusals.
    world();
    assert.equal(await link('out', 'P1'), 404, 'an outsider gets not-found');
    assert.equal(await link('ann', 'P1'), 403, 'a player cannot use the staff route');
    assert.equal(await link('viewer', 'P1'), 403);
    assert.equal(await link('coach', 'P1', { userId: 'stranger' }), 400, 'linking to a non-member is a 400');
    assert.equal(await link('coach', 'P1', {}), 400, 'userId is required');
    assert.equal(await link('coach', 'P1', { userId: 'viewer' }), 400, 'a viewer cannot be linked');
    assert.equal(await link('coach', 'P1', { userId: 'asst' }), 400, 'a staff member cannot be linked');
    assert.equal(await link('coach', 'P2'), 409, 'an already-claimed record');
    assert.equal(await link('coach', 'P1', { userId: 'ann' }), 409, 'one record per member per team');
    assert.equal(await link('coach', 'P3'), 404, "another team's record");
    assert.equal(await send(base, 'DELETE', '/api/v1/teams/T/players/P1/link', tokenFor('coach')), 409, 'unlinking an unclaimed record');
    assert.equal(await send(base, 'DELETE', '/api/v1/teams/T/players/P2/link', tokenFor('out')), 404);
    assert.equal(callsFor('player', 'update').length, 0, 'nothing written on a refusal');
    assert.equal(callsFor('auditLog', 'create').length, 0, 'nothing audited on a refusal');
  });
  console.log('http.playerRecordLink.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
