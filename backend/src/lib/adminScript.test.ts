// 9.0.8: admin scripts that write (scrub-deleted-messages, and delete-account
// in 9.4) must never reach production by accident. Prisma and dotenv fill an
// unset DATABASE_URL from backend/.env, which is production.
import assert from 'node:assert/strict';
import { adminScriptTarget, projectRef } from './adminScript';

const LOCAL = 'postgresql://ci:ci@localhost:55433/ci';
const err = (r: ReturnType<typeof adminScriptTarget>) => ('error' in r ? r.error : null);

// Without --prod: an explicit local database, or nothing.
assert.ok(err(adminScriptTarget([], {})), 'unset DATABASE_URL is refused (it would fall through to production)');
assert.ok(err(adminScriptTarget(['--apply'], { DATABASE_URL: 'postgresql://u:p@db.abc.supabase.co:5432/postgres' })), 'a remote database needs --prod');
assert.ok(err(adminScriptTarget([], { DATABASE_URL: LOCAL, DIRECT_URL: 'postgresql://u:p@db.abc.supabase.co/postgres' })), 'both URLs must be local');
const local = adminScriptTarget(['--apply'], { DATABASE_URL: LOCAL });
assert.deepEqual(local, {
  apply: true, prod: false,
  // Local runs never touch real storage: blanked, so dotenv can't fill them.
  env: { DIRECT_URL: LOCAL, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
});
assert.deepEqual(adminScriptTarget([], { DATABASE_URL: LOCAL }), { apply: false, prod: false, env: { DIRECT_URL: LOCAL, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' } }, 'a dry run by default');

// --prod: backend/.env, said out loud.
assert.deepEqual(adminScriptTarget(['--prod'], {}), { apply: false, prod: true, env: {} });
assert.deepEqual(adminScriptTarget(['--prod', '--apply'], {}), { apply: true, prod: true, env: {} });

// The project ref, never the URL (it holds the password).
assert.equal(projectRef('postgresql://postgres.abcdefgh:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres'), 'abcdefgh');
assert.equal(projectRef('postgresql://postgres:secret@db.abcdefgh.supabase.co:5432/postgres'), 'abcdefgh');
assert.equal(projectRef(LOCAL), 'localhost');
assert.equal(projectRef('not a url'), 'unknown');
assert.equal(projectRef(undefined), 'unknown');

console.log('adminScript.test.ts passed');
