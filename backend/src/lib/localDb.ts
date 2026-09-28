// Integration tests create and delete rows, so they must only ever touch a
// local database. Both URLs are checked, and an unset or empty one is refused:
// instrument.ts calls dotenv.config() and Prisma Client loads backend/.env by
// itself, so a missing variable silently falls through to production.
// Same rule as scripts/run-integration-tests.js (plain JS, so it keeps its own copy).

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

const isLocal = (url: string) => {
  try { return LOCAL_HOSTS.includes(new URL(url).hostname); } catch { return false; }
};

/** Why these env vars aren't safe for integration tests, or null when they are. */
export function localDbUrlError(env: Record<string, string | undefined>): string | null {
  for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
    if (!isLocal(env[name] ?? '')) {
      return `Refusing to run integration tests: ${name} must be set and point at localhost or 127.0.0.1. Run them with npm run test:integration.`;
    }
  }
  return null;
}
