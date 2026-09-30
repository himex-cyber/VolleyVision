// 9.3 on real Postgres: signup needs the 13+ / Terms tick; an account from
// before v9.17.0 is told to accept on its next sign-in, and can't post in team
// chat until it does (Play's user-generated-content policy). Reading, tracking
// and everything else stay open.
import assert from 'node:assert/strict';
import { prisma, startApp, makeUser, makeTeam, addMember, cleanup, call, RUN } from './harness';
import { CURRENT_TERMS_VERSION } from '../lib/terms';

async function main() {
  const app = await startApp();
  try {
    // Signup.
    const signup = (acceptTerms?: unknown) => call(app.base, 'POST', '/api/v1/auth/register', undefined, {
      email: `${RUN}-new@integration.test`, password: 'long enough pw', firstName: 'New', lastName: 'Member',
      ...(acceptTerms === undefined ? {} : { acceptTerms }),
    });
    for (const bad of [undefined, false, 'true']) {
      const r = await signup(bad);
      assert.equal(r.status, 400, `signup without a ticked box (${JSON.stringify(bad)})`);
      assert.match(r.body.error, /13 or older/);
    }
    const ok = await signup(true);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.user.termsRequired, false);
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: `${RUN}-new@integration.test` } });
    assert.equal(stored.termsVersion, CURRENT_TERMS_VERSION);
    assert.ok(stored.termsAcceptedAt);

    // An older account, never asked.
    const coach = await makeUser('coach');
    const old = await makeUser('old', { terms: false });
    const team = await makeTeam(coach, 'Terms');
    await addMember(team.id, old, 'PLAYER');
    const channel = await prisma.channel.create({ data: { teamId: team.id, type: 'TEAM' } });
    const mine = await prisma.message.create({ data: { channelId: channel.id, senderId: old.id, body: 'from before' } });

    assert.equal((await call(app.base, 'GET', '/api/v1/auth/me', old.token)).body.termsRequired, true, '/auth/me asks for it');
    assert.equal((await call(app.base, 'GET', `/api/v1/channels/${channel.id}/messages`, old.token)).status, 200, 'reading stays open');

    const post = await call(app.base, 'POST', `/api/v1/channels/${channel.id}/messages`, old.token, { body: 'hi' });
    assert.equal(post.status, 403);
    assert.equal(post.body.code, 'TERMS_REQUIRED');
    const upload = await call(app.base, 'POST', `/api/v1/channels/${channel.id}/messages/upload`, old.token, {});
    assert.equal(upload.body.code, 'TERMS_REQUIRED', 'uploads too');
    const edit = await call(app.base, 'PATCH', `/api/v1/messages/${mine.id}`, old.token, { body: 'edited' });
    assert.equal(edit.body.code, 'TERMS_REQUIRED', 'and edits');

    const accept = await call(app.base, 'POST', '/api/v1/profile/accept-terms', old.token);
    assert.equal(accept.status, 200, JSON.stringify(accept.body));
    assert.equal(accept.body.termsRequired, false);
    assert.equal((await call(app.base, 'GET', '/api/v1/auth/me', old.token)).body.termsRequired, false);
    assert.equal((await call(app.base, 'POST', `/api/v1/channels/${channel.id}/messages`, old.token, { body: 'hi' })).status, 201, 'posting works once accepted');

    // An outsider still gets the team's 404 first, not a Terms answer.
    const outsider = await makeUser('outsider', { terms: false });
    assert.equal((await call(app.base, 'POST', `/api/v1/channels/${channel.id}/messages`, outsider.token, { body: 'x' })).status, 404);
    assert.equal((await call(app.base, 'POST', '/api/v1/profile/accept-terms')).status, 401, 'accepting needs a session');

    console.log('terms: all tests passed');
  } finally {
    await app.close();
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
