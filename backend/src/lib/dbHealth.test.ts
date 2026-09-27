import assert from 'node:assert/strict';
import { checkDatabase } from './dbHealth';

async function main() {
  assert.equal(await checkDatabase(async () => 1), true, 'a ping that answers is healthy');
  assert.equal(
    await checkDatabase(async () => {
      throw new Error('project paused');
    }),
    false,
    'a ping that fails is unhealthy',
  );

  // The case the timeout exists for: a paused database hangs instead of failing.
  const started = Date.now();
  assert.equal(await checkDatabase(() => new Promise(() => {}), 50), false, 'a ping that hangs is unhealthy');
  assert.ok(Date.now() - started < 1000, 'a hanging ping is cut off at the timeout, not waited out');

  console.log('Database health check tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
