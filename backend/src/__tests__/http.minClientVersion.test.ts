// 8.5.0.2: Android builds older than 9.13.0 send stale absolute scores and
// shift match times on edit, so the API refuses them with 426. Everything else
// passes the gate untouched: the web (no header), current apps, iOS, and any
// header it can't parse. CORS runs first, so a 426 still reaches the app.
process.env.CLIENT_URL = 'https://volleyvision-app.netlify.app';
process.env.CORS_EXTRA_ORIGINS = 'https://localhost';

import assert from 'node:assert/strict';
import '../testing/installFakePrisma';
import { withServer } from '../testing/http';

async function get(base: string, path: string, client?: string) {
  const headers: Record<string, string> = { origin: 'https://localhost' };
  if (client !== undefined) headers['x-client'] = client;
  const res = await fetch(`${base}${path}`, { headers });
  const body = (await res.json().catch(() => null)) as { code?: string; error?: string } | null;
  return { status: res.status, body, acao: res.headers.get('access-control-allow-origin') };
}

async function main() {
  await withServer(async (base) => {
    const old = await get(base, '/api/v1/auth/me', 'android/9.12.0');
    assert.equal(old.status, 426, 'an old Android build is refused');
    assert.equal(old.body?.code, 'APP_OUTDATED');
    assert.match(old.body?.error ?? '', /update/i);
    assert.equal(old.acao, 'https://localhost', 'the refusal still carries CORS headers');
    assert.equal((await get(base, '/api/v1/auth/login', 'android/9.10.0')).status, 426, 'every /api/v1 route');

    // Passes the gate, then meets auth as usual (/auth/me: 401 without a token).
    for (const client of [undefined, 'android/9.13.0', 'android/9.14.0', 'ios/9.15.0', 'ios/0.0.1', 'android/unknown', 'nonsense']) {
      assert.equal((await get(base, '/api/v1/auth/me', client)).status, 401, `passes: ${client ?? '(web, no header)'}`);
    }

    // Preflights never reach the gate.
    const pre = await fetch(`${base}/api/v1/teams`, {
      method: 'OPTIONS',
      headers: { origin: 'https://localhost', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,x-client', 'x-client': 'android/9.10.0' },
    });
    await pre.text();
    assert.equal(pre.status, 204);

    // /health is outside /api/v1.
    assert.notEqual((await get(base, '/health', 'android/9.10.0')).status, 426);
  });
  console.log('http.minClientVersion.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
