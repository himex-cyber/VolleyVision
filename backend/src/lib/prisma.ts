import { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { isSerializationConflict, retryOnConflict } from './serializationConflict';

// Singleton pattern prevents connection pool exhaustion during hot reloads in
// development. In production (Node.js process stays alive) this is just a
// single instance. Pattern from Prisma's official Next.js recommendation,
// adapted for Express.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    // Join codes let anyone holding one join the team — the staff code as
    // staff. Every `include: { team: true }` or full Team read used to ship
    // both codes to any member (players and viewers included). Omitting them
    // globally makes leaking them opt-in: only an explicit `select` returns
    // them, which today is getTeamJoinCodes: the player code for members with
    // invitation access, the staff code only at FULL_ACCESS.
    omit: { team: { playerJoinCode: true, staffJoinCode: true } },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Run a check-then-write as one SERIALIZABLE transaction, so a concurrent
 * request can't slip in between the check and the write (two joins taking the
 * last assistant slot, a role edit racing an ownership transfer, a double
 * claim). Postgres aborts the loser; that becomes a 409 the user can retry
 * instead of a 500.
 */
export async function runSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await retryOnConflict(() => prisma.$transaction(fn, { isolationLevel: 'Serializable' }));
  } catch (err) {
    if (isSerializationConflict(err)) {
      throw new AppError(409, 'Someone else changed this at the same moment. Please try again.');
    }
    throw err;
  }
}
