import assert from 'node:assert/strict';
import { localDbUrlError } from './localDb';

const LOCAL = 'postgresql://ci:ci@localhost:55433/ci';

assert.equal(localDbUrlError({ DATABASE_URL: LOCAL, DIRECT_URL: LOCAL }), null);
assert.equal(localDbUrlError({ DATABASE_URL: 'postgresql://a:b@127.0.0.1:5432/x', DIRECT_URL: 'postgresql://a:b@127.0.0.1:5432/x' }), null);

// Unset or empty falls through to backend/.env (production) via dotenv or Prisma.
assert.match(localDbUrlError({}) ?? '', /DATABASE_URL/);
assert.match(localDbUrlError({ DATABASE_URL: LOCAL }) ?? '', /DIRECT_URL/, 'DIRECT_URL must be set too');
assert.match(localDbUrlError({ DATABASE_URL: '', DIRECT_URL: LOCAL }) ?? '', /DATABASE_URL/);

// Anything remote, or unparseable, is refused.
assert.match(localDbUrlError({ DATABASE_URL: 'postgresql://u:p@db.abc.supabase.co:5432/postgres', DIRECT_URL: LOCAL }) ?? '', /DATABASE_URL/);
assert.match(localDbUrlError({ DATABASE_URL: LOCAL, DIRECT_URL: 'postgresql://u:p@aws-0.pooler.supabase.com:6543/postgres' }) ?? '', /DIRECT_URL/);
assert.match(localDbUrlError({ DATABASE_URL: 'not a url', DIRECT_URL: LOCAL }) ?? '', /DATABASE_URL/);
assert.match(localDbUrlError({ DATABASE_URL: 'postgresql://u:p@localhost.evil.example/x', DIRECT_URL: LOCAL }) ?? '', /DATABASE_URL/);

console.log('localDb.test.ts passed');
