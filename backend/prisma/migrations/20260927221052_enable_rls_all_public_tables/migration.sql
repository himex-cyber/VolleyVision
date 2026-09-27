-- Enable RLS on every public table, and revoke Supabase's default anon /
-- authenticated grants.
--
-- Why: prod had RLS switched on by hand for most tables; only 2 were ever in a
-- migration (20260902100000_enable_rls_on_public_tables). A database rebuilt
-- from migrations - staging, a restore, CI - would expose the other 19 public
-- tables, _prisma_migrations included, to the anon key through PostgREST.
--
-- ENABLE ROW LEVEL SECURITY is idempotent, so on prod that half changes
-- nothing. The REVOKE is a real change on prod: it removes Supabase's default
-- table grants to anon and authenticated. That is safe because the app reaches
-- the database only through Prisma, connected as the table owner (owners
-- bypass RLS and keep their own privileges), and supabase-js is used only for
-- Storage (chatStorage.service.ts, feedbackStorage.service.ts) - never the
-- public schema. The frontend does not use Supabase at all.
--
-- The pg_roles guard lets this run on plain Postgres (CI), where the Supabase
-- roles don't exist.
--
-- Every new table from here on enables RLS in its own migration; this loop
-- only covers the tables that exist when it runs.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
  END IF;
END $$;
