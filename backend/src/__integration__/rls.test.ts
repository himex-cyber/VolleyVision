// Every public table has row-level security on, in a database built purely
// from migrations. Supabase exposes the public schema to the anon key through
// PostgREST, so a table without RLS is world-readable there. New tables must
// enable RLS in their own migration; this is what catches one that doesn't.
import './requireLocalDb'; // first: refuses a non-local DB before dotenv/Prisma load
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';

async function main() {
  try {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity ORDER BY tablename`;
    assert.deepEqual(rows.map((r) => r.tablename), [], 'public tables without RLS');
    // Second lock: RLS with no policy already denies anon/authenticated, but a
    // table whose RLS is ever switched off would be open to them if they still
    // held grants, so they must hold none (as on prod). The roles come from
    // scripts/supabase-roles.sql; on a database whose migrations ran before the
    // roles existed (a long-lived local one) this passes without testing much -
    // CI's fresh database is where it bites.
    const [grants] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`;
    assert.equal(Number(grants.n), 0, 'anon/authenticated hold grants on public tables: REVOKE them in the migration that creates the table');
    console.log('rls.test.ts passed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
