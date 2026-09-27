#!/usr/bin/env node
// Runs every src/lib/*.test.ts sequentially via ts-node and fails on the
// first error. Used by `npm test` — plain Node so it works on any platform.
const { spawnSync } = require('child_process');
const { readdirSync } = require('fs');
const path = require('path');

// A cycle hands one module a half-initialised copy of the other, so the
// failure surfaces later and somewhere else. Cheap to check, so check first.
const cycleCheck = spawnSync(
  process.execPath,
  [path.join(__dirname, 'check-import-cycles.js')],
  { stdio: 'inherit', cwd: path.join(__dirname, '..') },
);
if (cycleCheck.status !== 0) process.exit(cycleCheck.status ?? 1);

const libDir = path.join(__dirname, '..', 'src', 'lib');
const unitTestsDir = path.join(__dirname, '..', 'src', '__tests__');

const testFiles = [
  ...readdirSync(libDir)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => path.join(libDir, f)),
  ...readdirSync(unitTestsDir)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => path.join(unitTestsDir, f)),
].sort();

if (testFiles.length === 0) {
  console.error('No test files found in src/lib or src/__tests__.');
  process.exit(1);
}

// The src/__tests__/http.*.test.ts files import the whole app, whose
// instrument.ts loads backend/.env. dotenv never overwrites a variable that is
// already set (even to ''), so pinning these keeps a real Sentry DSN, SMTP
// login or Supabase key in that file from being used by a test run.
const childEnv = {
  ...process.env,
  // A dead local address: every test must go through installFakePrisma, and
  // one that forgets fails here instead of reaching backend/.env's prod DB.
  DATABASE_URL: 'postgresql://unit-tests@127.0.0.1:1/none',
  DIRECT_URL: 'postgresql://unit-tests@127.0.0.1:1/none',
  NETLIFY: '1', // index.ts must not listen; http tests start their own server
  NODE_ENV: 'test', // in-memory rate limiter
  JWT_SECRET: process.env.JWT_SECRET || 'test-secret',
  SENTRY_DSN: '',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASS: '',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
};

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

console.log(`\nAll ${testFiles.length} test files passed.`);
