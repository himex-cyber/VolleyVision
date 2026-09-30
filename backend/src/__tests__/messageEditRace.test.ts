// 9.0.10 (Opus review): an edit that loses a race with a delete must not write
// its text back onto the erased message (9.0.8). The update is conditional on
// the message still being live.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { editMessage } from '../services/message.service';

async function main() {
  resetDb();
  // The read sees a live message; a moderator's delete lands before the write.
  db.message.findUnique = async () => ({ senderId: 'u1', deletedAt: null });
  db.message.updateMany = async () => ({ count: 0 });
  await assert.rejects(editMessage('m1', 'u1', 'new text'), (e: any) => e.statusCode === 409);
  assert.deepEqual(callsFor('message', 'updateMany')[0][0].where, { id: 'm1', deletedAt: null });

  console.log('messageEditRace.test.ts passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
