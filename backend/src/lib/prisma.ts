import { PrismaClient } from '@prisma/client';

// Singleton pattern prevents connection pool exhaustion during hot reloads in
// development. In production (Node.js process stays alive) this is just a
// single instance. Pattern from Prisma's official Next.js recommendation,
// adapted for Express.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    // Join codes let anyone holding one join the team — the staff code as a
    // MANAGER. Every `include: { team: true }` or full Team read used to ship
    // both codes to any member (players and viewers included). Omitting them
    // globally makes leaking them opt-in: only an explicit `select` returns
    // them, which today is getTeamJoinCodes behind MANAGE_MEMBERS.
    omit: { team: { playerJoinCode: true, staffJoinCode: true } },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
