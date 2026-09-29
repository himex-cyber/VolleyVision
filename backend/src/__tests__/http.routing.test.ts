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

  // 60 = the global bucket's size. Only 5 get past the per-IP arm, so only
  // those 5 may spend global tokens.
  const flood = await Promise.all(Array.from({ length: 60 }, (_, i) => send('203.0.113.1', `flood${i}@example.test`)));
  assert.equal(flood.filter((s) => s === 200).length, 5);

  // A different caller must still get through: 55 tokens are left.
  assert.equal(await send('198.51.100.7', 'victim@example.test'), 200, 'one IP drained the global reset limiter');
}

// 8.3: a bad from/to is parsed only after the visibility guard, so an
// outsider gets the same 404 as for a team that doesn't exist, never a 400
// that confirms the team is real (the Phase 2 ordering rule).
async function outsiderBadDateIs404(base: string) {
  resetDb();
  db.team.findUnique = async () => ({ id: 'T', ownerId: 'someone-else', teamId: 'T' });
  db.player.findUnique = async () => ({ id: 'p1', firstName: 'A', lastName: 'B', jerseyNumber: 1, position: 'SETTER', teamId: 'T', userId: 'u' });
  for (const path of [
    '/api/v1/analytics/teams/T?from=bad',
    '/api/v1/analytics/teams/T/trends?from=bad',
    '/api/v1/analytics/teams/T/zones?to=2026-02-30',
    '/api/v1/analytics/teams/T/rotations?from=bad',
    '/api/v1/analytics/teams/T/advanced?from=bad',
    '/api/v1/analytics/players/p1?from=bad',
    '/api/v1/analytics/players/p1/zones?from=bad',
    '/api/v1/matches/by-team/T?from=bad',
  ]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 404, path);
  }
}

async function main() {
  await withServer(async (base) => {
    await unauthenticatedIs401(base);
    await unknownTeamIs404(base);
    await forgotPasswordLimiterOrder(base);
    await outsiderBadDateIs404(base);
  });
  console.log('http.routing.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
