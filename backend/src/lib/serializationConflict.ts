// Postgres aborts the loser of two racing SERIALIZABLE transactions, and Prisma
// reports that as P2034. Pure (no Prisma import) so it can be unit-tested; the
// transaction wrapper that uses it lives in lib/prisma.ts.
export function isSerializationConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2034';
}
