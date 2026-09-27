import assert from 'node:assert/strict';
import { asyncHandler } from '../middleware/asyncHandler';

async function testRejectionReachesNext() {
  const err = new Error('boom');
  const handler = asyncHandler(async () => {
    throw err;
  });

  let passedToNext: unknown;
  const next = (e: unknown) => {
    passedToNext = e;
  };

  handler({} as any, {} as any, next as any);
  // The handler's rejection is caught asynchronously (a .catch on the
  // returned promise) — give the microtask queue a turn before asserting.
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(passedToNext, err, 'a rejected handler must forward its error to next()');
}

async function main() {
  await testRejectionReachesNext();
  console.log('asyncHandler.test.ts passed');
}

main();
