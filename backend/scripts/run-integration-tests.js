#!/usr/bin/env node
// Runs every src/__integration__/*.test.ts against a real, LOCAL Postgres.
// Used by `npm run test:integration` (CI's db job, or locally against a
// throwaway database). Same shape as run-tests.js.
//
// Refuses anything but localhost. The check needs DATABASE_URL set AND
// non-empty: instrument.ts calls dotenv.config() and Prisma Client loads
// backend/.env by itself, so an unset variable would silently fall through to
// the production database, and these tests create and delete rows.
const path = require('path');
const { spawnSync } = require('child_process');
const { runTestFiles, srcDir } = require('./test-runner');

const isLocal = (url) => {
  try { return ['localhost', '127.0.0.1'].includes(new URL(url).hostname); } catch { return false; }
};
const databaseUrl = process.env.DATABASE_URL || '';
const directUrl = process.env.DIRECT_URL || databaseUrl;
if (!isLocal(databaseUrl) || !isLocal(directUrl)) {
  console.error('Refusing to run integration tests: DATABASE_URL (and DIRECT_URL, if set) must point at localhost or 127.0.0.1.');
  process.exit(1);
}

// Every variable something might read, pinned. dotenv never overwrites a
// variable that is already set (even to ''), so backend/.env can't leak real
// SMTP, Supabase or Sentry credentials into a test run.
const childEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DIRECT_URL: directUrl,
  NETLIFY: '1', // index.ts must not listen; each test starts its own server
  NODE_ENV: 'test', // in-memory rate limiter
  JWT_SECRET: 'integration-test-secret',
  SENTRY_DSN: '',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASS: '',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
};

// The Supabase roles and default grants (idempotent). CI applies them before
// migrating, which is what makes rls.test.ts's grants check real; on a local
// database migrated before the roles existed that check passes without testing
// much, but the roles still need to exist for it to run.
const prismaCli = require.resolve('prisma/build/index.js', { paths: [path.join(__dirname, '..')] });
const roles = spawnSync(process.execPath, [prismaCli, 'db', 'execute', '--url', directUrl, '--file', path.join(__dirname, 'supabase-roles.sql')], { stdio: 'inherit', env: childEnv });
if (roles.status !== 0) process.exit(roles.status ?? 1);

runTestFiles({ dirs: [path.join(srcDir, '__integration__')], env: childEnv, label: 'integration test' });
