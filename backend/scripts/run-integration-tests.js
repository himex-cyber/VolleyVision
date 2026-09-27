#!/usr/bin/env node
// Runs every src/__integration__/*.test.ts against a real, LOCAL Postgres.
// Used by `npm run test:integration` (CI's db job, or locally against a
// throwaway database). Same shape as run-tests.js.
//
// Refuses anything but localhost. The check needs DATABASE_URL set AND
// non-empty: instrument.ts calls dotenv.config() and Prisma Client loads
// backend/.env by itself, so an unset variable would silently fall through to
// the production database, and these tests create and delete rows.
const { spawnSync } = require('child_process');
const { readdirSync } = require('fs');
const path = require('path');

const databaseUrl = process.env.DATABASE_URL || '';
let host = '';
try { host = new URL(databaseUrl).hostname; } catch { /* host stays '' */ }
if (host !== 'localhost' && host !== '127.0.0.1') {
  console.error('Refusing to run integration tests: DATABASE_URL must be set and point at localhost or 127.0.0.1.');
  process.exit(1);
}

// Every variable something might read, pinned. dotenv never overwrites a
// variable that is already set (even to ''), so backend/.env can't leak real
// SMTP, Supabase or Sentry credentials into a test run.
const childEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DIRECT_URL: process.env.DIRECT_URL || databaseUrl,
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

const dir = path.join(__dirname, '..', 'src', '__integration__');
const testFiles = readdirSync(dir)
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => path.join(dir, f))
  .sort();

if (testFiles.length === 0) {
  console.error('No test files found in src/__integration__.');
  process.exit(1);
}

const tsNodeBin = require.resolve('ts-node/dist/bin.js', {
  paths: [path.join(__dirname, '..')],
});

for (const fullPath of testFiles) {
  const file = path.relative(path.join(__dirname, '..', 'src'), fullPath);
  console.log(`\n── ${file} ──`);
  const result = spawnSync(
    process.execPath,
    [tsNodeBin, '--transpile-only', fullPath],
    { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: childEnv },
  );
  if (result.status !== 0) {
    console.error(`\nFAILED: ${file}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nAll ${testFiles.length} integration test files passed.`);
