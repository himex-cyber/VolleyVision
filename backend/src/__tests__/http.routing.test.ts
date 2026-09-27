// Fast HTTP layer: the whole Express app on a random port, over the fake
// Prisma client, so middleware ORDER and status codes are tested the way a
// real request meets them. Runs in `npm test`; scripts/run-tests.js pins
// NETLIFY=1 (no listen) and blanks every real-service credential.
import assert from 'node:assert/strict';
import { db, resetDb } from '../testing/installFakePrisma';
import { withServer } from '../testing/http';

async function unauthenticatedIs401(base: string) {
  const res = await fetch(`${base}/api/v1/teams/my-teams`);
  assert.equal(res.status, 401);
}

async function unknownTeamIs404(base: string) {
  resetDb();
  db.team.findUnique = async () => null;
  const res = await fetch(`${base}/api/v1/teams/does-not-exist`);
  assert.equal(res.status, 404);
}

// The per-IP/email limiter must run before the global one, or one IP can
// drain the global bucket and block everyone's resets (roadmap defect 3).
async function forgotPasswordLimiterOrder(base: string) {
  resetDb();
  db.user.findUnique = async () => null; // unknown address: no mail, 200 after the timing floor
  const send = (ip: string, email: string) =>
    fetch(`${base}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip },
      body: JSON.stringify({ email }),
    }).then((r) => r.status);

  // 60 = the global bucket's size. Only 5 get past the per-IP arm.
  const startedAt = Date.now();
  const flood = await Promise.all(Array.from({ length: 60 }, (_, i) => send('203.0.113.1', `flood${i}@example.test`)));
  assert.equal(flood.filter((s) => s === 200).length, 5);

  // A different caller must still get through.
  // TODO(P2): today the global limiter runs first, so the flood drained it and
  // this is 429. Phase 2 (defect 3) reorders them; flip this to 200.
  // The global bucket refills one token every 15s, so on a runner slow enough
  // to take that long the drained state is gone; don't assert it there.
  const victim = await send('198.51.100.7', 'victim@example.test');
  if (Date.now() - startedAt < 14_000) assert.equal(victim, 429);
}

async function main() {
  await withServer(async (base) => {
    await unauthenticatedIs401(base);
    await unknownTeamIs404(base);
    await forgotPasswordLimiterOrder(base);
  });
  console.log('http.routing.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
