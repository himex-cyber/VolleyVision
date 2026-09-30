// 9.4 with fakePrisma: refusals never open the transaction, and files and the
// confirmation email only follow a committed deletion. The data itself is
// proven on real Postgres (__integration__/accountDeletion.test.ts).
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { db, resetDb } from '../testing/installFakePrisma';
import { rawCallsMade } from '../testing/fakePrisma';
import { deleteAccount, deleteAccountWithPassword } from '../services/accountDeletion.service';

async function main() {
  const hash = await bcrypt.hash('right password', 4);
  const world = (role = 'PLAYER', owned: { id: string; name: string }[] = []) => {
    resetDb();
    db.user.findUnique = async () => ({ passwordHash: hash, role, email: 'Lea@X.test' });
    db.team.findMany = async () => owned;
    db.teamMembership.findMany = async () => [];
  };

  world();
  await assert.rejects(deleteAccountWithPassword('u1', 'wrong'), (e: any) => e.statusCode === 403 && e.code === 'WRONG_PASSWORD');
  assert.equal(rawCallsMade().length, 0, 'a wrong password opens no transaction');

  world();
  await assert.rejects(deleteAccountWithPassword('u1', ''), (e: any) => e.statusCode === 400);

  world('ADMIN');
  await assert.rejects(deleteAccountWithPassword('u1', 'right password'), (e: any) => e.statusCode === 403);
  assert.equal(rawCallsMade().length, 0, 'an admin uses the script');

  world('PLAYER', [{ id: 't1', name: 'Falcons' }]);
  await assert.rejects(deleteAccountWithPassword('u1', 'right password'),
    (e: any) => e.statusCode === 409 && e.code === 'ACCOUNT_HAS_TEAMS' && e.details.teams[0].name === 'Falcons');
  assert.equal(rawCallsMade().length, 0, 'an owner is refused before any write');

  // A committed deletion: the user row goes last, then files, then the email.
  world();
  const order: string[] = [];
  db.messageAttachment.findMany = async () => [{ storagePath: 'teams/t/a.png' }];
  db.feedbackAttachment.findMany = async () => [{ storagePath: 'feedback/f/b.pdf' }];
  db.player.findMany = async () => [];
  db.messageAttachment.deleteMany = async () => { order.push('attachments'); return { count: 1 }; };
  db.player.updateMany = async () => { order.push('players'); return { count: 0 }; };
  db.user.delete = async () => { order.push('user'); return {}; };
  await deleteAccount('u1', {
    removeFiles: async (paths) => { order.push(`files:${paths.join(',')}`); return 0; },
    notify: async (email) => { order.push(`mail:${email}`); },
  });
  assert.deepEqual(order, ['attachments', 'players', 'user', 'files:teams/t/a.png,feedback/f/b.pdf', 'mail:lea@x.test']);

  // A failed transaction sends nothing and removes no files.
  world();
  const after: string[] = [];
  db.messageAttachment.findMany = async () => [{ storagePath: 'x' }];
  db.feedbackAttachment.findMany = async () => [];
  db.player.findMany = async () => [];
  db.messageAttachment.deleteMany = async () => { throw new Error('db down'); };
  await assert.rejects(deleteAccount('u1', { removeFiles: async () => { after.push('files'); return 0; }, notify: async () => { after.push('mail'); } }));
  assert.deepEqual(after, []);

  console.log('accountDeletion.test.ts passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
