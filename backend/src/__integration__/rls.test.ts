// Every public table has row-level security on, in a database built purely
// from migrations. Supabase exposes the public schema to the anon key through
// PostgREST, so a table without RLS is world-readable there. New tables must
// enable RLS in their own migration; this is what catches one that doesn't.
import assert from 'node:assert/strict';
import { prisma } from '../lib/prisma';

async function main() {
  try {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity ORDER BY tablename`;
    assert.deepEqual(rows.map((r) => r.tablename), [], 'public tables without RLS');
    console.log('rls.test.ts passed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
