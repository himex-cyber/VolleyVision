// Roadmap defect 4: the team-link guard read body.teamId before the URL's
// :teamId, so DELETE /players/P/team-links/VICTIM with body {teamId: MINE}
// passed the check on the caller's own team and then unlinked the player
// from a team the caller has nothing to do with.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { withServer, tokenFor, send } from '../testing/http';

// "me" is head coach of MINE only; VICTIM belongs to someone else.
function world() {
  resetDb();
  db.user.findUnique = async () => ({ tokenVersion: 0, role: 'COACH' });
  db.team.findUnique = async (args: any) =>
    ({ MINE: { ownerId: 'me', id: 'MINE' }, VICTIM: { ownerId: 'victimOwner', id: 'VICTIM' } } as any)[args.where.id] ?? null;
  db.teamMembership.findUnique = async () => null;
  db.playerTeamLink.findUnique = async () => ({ playerId: 'P', teamId: 'VICTIM' });
  db.playerTeamLink.delete = async () => ({});
}

async function main() {
  await withServer(async (base) => {
    world();
    const me = tokenFor('me');
    assert.equal(await send(base, 'DELETE', '/api/v1/players/P/team-links/VICTIM', me, { teamId: 'MINE' }), 400,
      'a body teamId that disagrees with the URL must be refused');
    assert.equal(await send(base, 'DELETE', '/api/v1/players/P/team-links/VICTIM', me), 404,
      "someone else's team is not found, not forbidden");
    assert.equal(callsFor('playerTeamLink', 'delete').length, 0, 'the victim link must survive');

    assert.equal(await send(base, 'DELETE', '/api/v1/players/P/team-links/MINE', me), 204, 'unlinking from your own team still works');
  });
  console.log('http.teamLinkGuard.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
