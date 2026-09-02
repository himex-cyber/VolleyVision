-- Enable RLS on the two public tables that were missing it.
--
-- Supabase exposes the public schema through PostgREST, so a table WITHOUT RLS
-- is readable and writable by anyone holding the anon key - which for this
-- project is shipped to the browser. For rate_limit_buckets that is fatal: a
-- caller could DELETE every bucket and reset their own limit, defeating the
-- limiter the row above it exists to enforce.
--
-- Deliberately no policies. Every other table in this database is in the same
-- "RLS enabled, no policies" state, which denies all access through PostgREST
-- while leaving the app untouched, because Prisma connects as the table owner
-- and owners bypass RLS. Supabase's linter reports that as INFO, not an error.
--
-- ponytail: this is deny-all, not least-privilege. If anything ever needs to
-- reach these tables through PostgREST rather than through the API, that is
-- when policies get written - not before.

ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "video_clips" ENABLE ROW LEVEL SECURITY;
