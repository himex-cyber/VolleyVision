// Roadmap defect 2: any MANAGER could delete the team. Deleting takes the
// team, its roster, matches and every event with it, so it is the owner's
// call alone. Visibility runs first, so an outsider still can't tell the team
// exists.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { withServer, tokenFor, send } from '../testing/http';

const TEAM = 'team1';
const ROLES: Record<string, string> = { manager: 'MANAGER', assistant: 'ASSISTANT_COACH' };

function world() {
  resetDb();
  db.user.findUnique = async () => ({ tokenVersion: 0, role: 'COACH' });
  db.team.findUnique = async (args: any) => (args.where.id === TEAM ? { ownerId: 'owner' } : null);
  db.teamMembership.findUnique = async (args: any) => {
    const role = ROLES[args.where.userId_teamId?.userId];
    return role ? { id: `m-${role}`, role, rosterAccess: 'FULL_ACCESS', invitationAccess: 'FULL_ACCESS', matchAccess: 'FULL_ACCESS' } : null;
  };
  db.team.delete = async () => ({ id: TEAM });
  db.auditLog.create = async () => ({});
}

async function main() {
  await withServer(async (base) => {
    world();
    assert.equal(await send(base, 'DELETE', `/api/v1/teams/${TEAM}`, tokenFor('manager')), 403, 'a manager must not delete the team');
    assert.equal(await send(base, 'DELETE', `/api/v1/teams/${TEAM}`, tokenFor('assistant')), 403);
    assert.equal(await send(base, 'DELETE', `/api/v1/teams/${TEAM}`, tokenFor('outsider')), 404, 'an outsider must not learn the team exists');
    assert.equal(callsFor('team', 'delete').length, 0, 'nothing may be deleted before the owner asks');

    assert.equal(await send(base, 'DELETE', `/api/v1/teams/${TEAM}`, tokenFor('owner')), 204);
    assert.equal(callsFor('team', 'delete').length, 1);
  });
  console.log('http.teamDelete.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
