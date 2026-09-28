#!/usr/bin/env node
// `npm test`: the import-cycle check, then every src/lib/*.test.ts and
// src/__tests__/*.test.ts (see test-runner.js for the loop).
const { spawnSync } = require('child_process');
const path = require('path');
const { runTestFiles, srcDir } = require('./test-runner');

// A cycle hands one module a half-initialised copy of the other, so the
// failure surfaces later and somewhere else. Cheap to check, so check first.
const cycleCheck = spawnSync(
  process.execPath,
  [path.join(__dirname, 'check-import-cycles.js')],
  { stdio: 'inherit', cwd: path.join(__dirname, '..') },
);
if (cycleCheck.status !== 0) process.exit(cycleCheck.status ?? 1);

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

runTestFiles({ dirs: [path.join(srcDir, 'lib'), path.join(srcDir, '__tests__')], env: childEnv, label: 'test' });
