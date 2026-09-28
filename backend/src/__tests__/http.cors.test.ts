// Phase 5: the Android app's WebView calls the API from origin
// https://localhost, so CORS allows CLIENT_URL plus the exact origins in
// CORS_EXTRA_ORIGINS. Exact string match only: anything else gets no
// Access-Control-Allow-Origin. Set before the app is imported.
process.env.CLIENT_URL = 'https://volleyvision-app.netlify.app';
process.env.CORS_EXTRA_ORIGINS = 'https://localhost';

import assert from 'node:assert/strict';
import '../testing/installFakePrisma';
import { withServer } from '../testing/http';

async function preflight(base: string, origin: string) {
  const res = await fetch(`${base}/api/v1/teams`, {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,x-client' },
  });
  await res.text();
  return { acao: res.headers.get('access-control-allow-origin'), headers: res.headers.get('access-control-allow-headers') ?? '' };
}

async function main() {
  await withServer(async (base) => {
    const app = await preflight(base, 'https://localhost');
    assert.equal(app.acao, 'https://localhost', 'the Android app origin is allowed when configured');
    assert.match(app.headers.toLowerCase(), /x-client/, 'the app-version header is allowed');
    assert.equal((await preflight(base, 'https://volleyvision-app.netlify.app')).acao, 'https://volleyvision-app.netlify.app', 'CLIENT_URL still works');
    assert.equal((await preflight(base, 'https://evil.example')).acao, null, 'any other origin gets no ACAO');
    assert.equal((await preflight(base, 'https://localhost.evil.example')).acao, null, 'exact match only');
  });
  console.log('http.cors.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
