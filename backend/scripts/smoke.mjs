#!/usr/bin/env node
// Post-deploy smoke check: `node backend/scripts/smoke.mjs <baseUrl>`.
// Plain fetch, one line per check, exits non-zero on the first failure.
//
// Always read-only and unauthenticated, so it's safe against prod. When
// SMOKE_EMAIL is set (staging only - the seed users), it also logs in as the
// seed owner and the outsider. Credentials come only from the environment:
//   SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_OUTSIDER_EMAIL, SMOKE_OUTSIDER_PASSWORD,
//   SMOKE_TEAM_ID, SMOKE_MATCH_ID
const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('Usage: node backend/scripts/smoke.mjs <baseUrl>');
  process.exit(2);
}

function pass(name) { console.log(`PASS  ${name}`); }
function fail(name, detail) {
  console.log(`FAIL  ${name} - ${detail}`);
  process.exit(1);
}
async function check(name, fn) {
  try {
    const problem = await fn();
    if (problem) fail(name, problem);
    pass(name);
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  }
}
const get = (path, token) =>
  fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

async function login(email, password) {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`login returned ${res.status}`);
  const { token } = await res.json();
  if (!token) throw new Error('login returned no token');
  return token;
}

await check('GET /health reports ok and db ok', async () => {
  const res = await get('/health');
  const body = await res.json().catch(() => null);
  if (res.status !== 200 || body?.status !== 'ok' || body?.db !== 'ok') return `${res.status} ${JSON.stringify(body)}`;
});

await check('GET / sends a Content-Security-Policy header', async () => {
  const res = await get('/');
  if (!res.headers.get('content-security-policy')) return `status ${res.status}, no content-security-policy header`;
});

await check('unknown team is 404 without a token', async () => {
  const res = await get('/api/v1/teams/does-not-exist');
  if (res.status !== 404) return `got ${res.status}`;
});

const { SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_OUTSIDER_EMAIL, SMOKE_OUTSIDER_PASSWORD, SMOKE_TEAM_ID, SMOKE_MATCH_ID } = process.env;

if (SMOKE_EMAIL) {
  const missing = ['SMOKE_PASSWORD', 'SMOKE_OUTSIDER_EMAIL', 'SMOKE_OUTSIDER_PASSWORD', 'SMOKE_TEAM_ID', 'SMOKE_MATCH_ID']
    .filter((k) => !process.env[k]);
  if (missing.length) fail('staging credentials', `missing ${missing.join(', ')}`);

  let ownerToken;
  await check('seed owner can log in', async () => { ownerToken = await login(SMOKE_EMAIL, SMOKE_PASSWORD); });
  for (const path of [
    '/api/v1/teams',
    `/api/v1/analytics/teams/${SMOKE_TEAM_ID}`,
    `/api/v1/analytics/teams/${SMOKE_TEAM_ID}/zones`,
    `/api/v1/analytics/matches/${SMOKE_MATCH_ID}/report`,
  ]) {
    await check(`owner GET ${path} is 200`, async () => {
      const res = await get(path, ownerToken);
      if (res.status !== 200) return `got ${res.status}`;
    });
  }

  let outsiderToken;
  await check('outsider can log in', async () => { outsiderToken = await login(SMOKE_OUTSIDER_EMAIL, SMOKE_OUTSIDER_PASSWORD); });
  await check("outsider gets 404 for the owner's team", async () => {
    const res = await get(`/api/v1/teams/${SMOKE_TEAM_ID}`, outsiderToken);
    if (res.status !== 404) return `got ${res.status}`;
  });
} else {
  console.log('SKIP  logged-in checks (SMOKE_EMAIL not set)');
}

console.log('Smoke check passed.');
