// Postgres aborts the loser of two racing SERIALIZABLE transactions, and Prisma
// reports that as P2034. Pure (no Prisma import) so it can be unit-tested; the
// transaction wrapper that uses it lives in lib/prisma.ts.
export function isSerializationConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2034';
}

// Runs fn, and once more if the first attempt lost a serialization race. SSI
// can abort a transaction that only touched a neighbouring row (two users each
// creating their first team at once), so one retry spares a false "someone else
// changed this". fn must be a whole transaction: the aborted attempt was rolled
// back, so re-running it is safe.
export async function retryOnConflict<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isSerializationConflict(err)) throw err;
    return fn();
  }
}
