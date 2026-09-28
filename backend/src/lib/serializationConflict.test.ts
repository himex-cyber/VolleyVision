import assert from 'node:assert/strict';
import { isSerializationConflict, retryOnConflict } from './serializationConflict';

assert.equal(isSerializationConflict({ code: 'P2034' }), true);
assert.equal(isSerializationConflict({ code: 'P2002' }), false, 'a unique violation is not a race to retry');
assert.equal(isSerializationConflict(new Error('boom')), false);
assert.equal(isSerializationConflict(null), false);
assert.equal(isSerializationConflict(undefined), false);

// One retry: Postgres SSI can abort a transaction that touched only a
// neighbouring row (e.g. two users each creating their first team), so the
// loser is re-run once before the user sees "someone else changed this".
(async () => {
  const conflict = { code: 'P2034' };
  let calls = 0;
  assert.equal(await retryOnConflict(async () => { calls++; if (calls === 1) throw conflict; return 'ok'; }), 'ok');
  assert.equal(calls, 2, 'a first conflict is retried once');

  calls = 0;
  await assert.rejects(retryOnConflict(async () => { calls++; throw conflict; }), (e) => e === conflict);
  assert.equal(calls, 2, 'a second conflict is not retried again');

  calls = 0;
  const other = new Error('boom');
  await assert.rejects(retryOnConflict(async () => { calls++; throw other; }), (e) => e === other);
  assert.equal(calls, 1, 'other errors are never retried');

  console.log('Serialization conflict tests passed.');
})().catch((err) => { console.error(err); process.exit(1); });
