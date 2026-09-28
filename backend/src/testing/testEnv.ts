// Imported before ../index by testing/http.ts, so an http test is safe even when
// run on its own (ts-node src/__tests__/http.x.test.ts) instead of through
// scripts/run-tests.js, which pins the same values. Without it, index.ts starts
// a real server on :3001 that keeps the process alive, and instrument.ts's
// dotenv fills every unset variable from backend/.env - the production database
// URL, SMTP login and Supabase key. dotenv never overwrites a variable that is
// already set (even to ''), so setting them here first keeps .env out.
process.env.NETLIFY ??= '1';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret';
// A dead address: tests run on installFakePrisma, and one that doesn't fails.
process.env.DATABASE_URL = 'postgresql://unit-tests@127.0.0.1:1/none';
process.env.DIRECT_URL = 'postgresql://unit-tests@127.0.0.1:1/none';
for (const key of ['SENTRY_DSN', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  process.env[key] = '';
}
