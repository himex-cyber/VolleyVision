// 9.0.8: best-effort file removal after a database delete. Chunked, never
// throws (the user's request already succeeded), and counts what it missed.
import assert from 'node:assert/strict';
import { removeStoredFiles } from './storageCleanup';

async function main() {
  const calls: string[][] = [];
  const ok = async (paths: string[]) => { calls.push(paths); return { error: null }; };

  assert.equal(await removeStoredFiles([], ok), 0);
  assert.equal(calls.length, 0, 'nothing to remove, no call');

  const paths = Array.from({ length: 250 }, (_, i) => `teams/t/channels/c/m${i}/f`);
  assert.equal(await removeStoredFiles(paths, ok), 0);
  assert.deepEqual(calls.map((c) => c.length), [100, 100, 50], 'chunks of 100');

  // One chunk errors and one throws: the rest still go, and the misses are counted.
  let n = 0;
  const flaky = async (chunk: string[]) => {
    n++;
    if (n === 1) return { error: { message: 'rate limited' } };
    if (n === 2) throw new Error('network');
    return { error: null, chunk };
  };
  assert.equal(await removeStoredFiles(paths, flaky), 200);
  assert.equal(n, 3, 'every chunk was attempted');

  console.log('storageCleanup.test.ts passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
