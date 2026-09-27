// Refuses anything but the staging database. scripts/seed-staging.ts writes
// users with a shared password, so pointing it at prod would plant known
// logins in the live app.

/** The live Supabase project ("Volley Vision"). Nothing staging-only may touch it. */
export const PROD_PROJECT_REF = 'rkkhrmhorgdqkxflipui';

/**
 * Returns an error message, or null when `env` clearly targets staging.
 * An empty STAGING_PROJECT_REF must fail: `url.includes('')` is always true.
 */
export function stagingGuardError(env: NodeJS.ProcessEnv): string | null {
  const ref = env.STAGING_PROJECT_REF?.trim();
  const url = env.DATABASE_URL ?? '';
  if (!ref) return 'STAGING_PROJECT_REF is not set.';
  if (ref === PROD_PROJECT_REF) return 'STAGING_PROJECT_REF is the production project.';
  if (!url) return 'DATABASE_URL is not set.';
  if (url.includes(PROD_PROJECT_REF)) return 'DATABASE_URL points at the production project.';
  if (!url.includes(ref)) return 'DATABASE_URL does not contain STAGING_PROJECT_REF.';
  return null;
}
