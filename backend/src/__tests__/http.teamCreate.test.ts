// Phase 4.5 (Karlos, 28 Sept): there's no global coach/player account type.
// Anyone can create a team and becomes its coach. Limits instead of the old
// signupIntent gate: at most 5 owned teams per account (a global admin is
// exempt), 5 creates an hour per user, and an ownership transfer can't push the
// receiver over the cap either.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { withServer, tokenFor, send } from '../testing/http';
import { transferOwnership } from '../services/teamOwnership.service';

const USERS: Record<string, { role: string; signupIntent: string | null; owned: number }> = {
  pat: { role: 'COACH', signupIntent: 'PLAYER', owned: 0 },
  full: { role: 'COACH', signupIntent: 'COACH', owned: 5 },
  admin: { role: 'ADMIN', signupIntent: null, owned: 7 },
  busy: { role: 'COACH', signupIntent: 'COACH', owned: 0 },
};

function world() {
  resetDb();
  db.user.findUnique = async (args: any) => {
    const u = USERS[args.where.id];
    return u ? { tokenVersion: 0, role: u.role, signupIntent: u.signupIntent } : null;
  };
  db.team.count = async (args: any) => USERS[args.where.ownerId]?.owned ?? 0;
  db.team.findUnique = async () => null; // no join-code clash
  db.team.create = async (args: any) => ({ id: 'NEW', ...args.data });
  db.teamMembership.findUnique = async () => null;
  db.teamMembership.create = async () => ({});
  db.auditLog.create = async () => ({});
}

const create = (base: string, who: string) =>
  send(base, 'POST', '/api/v1/teams', tokenFor(who), { name: 'Hawks', season: '2026' });

async function main() {
  await withServer(async (base) => {
    world();
    assert.equal(await create(base, 'pat'), 201, 'a player-intent account can create a team');
    assert.equal(await create(base, 'full'), 409, 'the 6th owned team is refused');
    assert.equal(await create(base, 'admin'), 201, 'a global admin is exempt from the cap');
    // The count and the create share one serializable transaction.
    assert.ok(callsFor('team', 'count').length >= 2);

    world();
    for (let i = 0; i < 5; i++) assert.equal(await create(base, 'busy'), 201, `create ${i + 1}`);
    assert.equal(await create(base, 'busy'), 429, 'the 6th create in an hour is rate-limited');
  });

  // Transfer respects the receiver's cap.
  world();
  db.team.findUnique = async () => ({ id: 'T', ownerId: 'owner' });
  db.teamMembership.findFirst = async (args: any) => ({ id: 'm', userId: args.where.user.email === 'full@x.test' ? 'full' : 'admin' });
  db.teamMembership.count = async () => 0;
  db.teamMembership.updateMany = async () => ({});
  db.teamMembership.update = async () => ({});
  db.team.update = async () => ({ id: 'T' });
  await assert.rejects(transferOwnership('T', 'owner', 'full@x.test'), (e: any) => e.statusCode === 409, 'transfer to someone who owns 5 is refused');
  assert.equal(callsFor('team', 'update').length, 0);
  await transferOwnership('T', 'owner', 'admin@x.test'); // admin exempt

  console.log('http.teamCreate.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
