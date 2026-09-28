-- Mimics Supabase on plain Postgres (CI's db job and the local test database):
-- the anon / authenticated roles PostgREST connects as, and the default
-- privileges that grant them every table created from now on. With these in
-- place, migration 20260927221052's pg_roles guard takes the REVOKE branch,
-- and rls.test.ts fails on any later migration that creates a table without
-- revoking those grants. Idempotent (CREATE ROLE has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
