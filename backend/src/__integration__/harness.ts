// Shared setup for src/__integration__ tests: the real app on a random port,
// and throwaway fixtures written straight through Prisma. Only ever run via
// scripts/run-integration-tests.js, which pins the env to a local database.
import './requireLocalDb'; // first: refuses a non-local DB before dotenv/Prisma load
import http from 'http';
import { AddressInfo } from 'net';
import { TeamRole } from '@prisma/client';
import app from '../index';
import { prisma } from '../lib/prisma';
import { generateToken } from '../services/auth.service';
import { defaultAccessTiers } from '../services/permission.service';

export { prisma };

export async function startApp(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// Every fixture carries this run's tag, so cleanup can't touch anything else.
export const RUN = `it${Date.now().toString(36)}`;

export type TestUser = { id: string; email: string; token: string };

export async function makeUser(key: string): Promise<TestUser> {
  const email = `${RUN}-${key}@integration.test`;
  const user = await prisma.user.create({
    data: { email, passwordHash: 'x', firstName: key, lastName: 'Test', emailVerifiedAt: new Date() },
  });
  return { id: user.id, email, token: generateToken({ userId: user.id, email, role: user.role, tv: 0 }) };
}

export async function makeTeam(owner: TestUser, name: string) {
  const team = await prisma.team.create({ data: { name: `${RUN} ${name}`, season: '2026', ownerId: owner.id } });
  await addMember(team.id, owner, 'HEAD_COACH');
  return team;
}

export async function addMember(teamId: string, user: TestUser, role: TeamRole) {
  return prisma.teamMembership.create({ data: { teamId, userId: user.id, role, ...defaultAccessTiers(role) } });
}

/** Deletes everything this run created. Teams cascade to members, players, matches and events. */
export async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { startsWith: `${RUN}-` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.team.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}

/** fetch with an optional bearer token and JSON body; returns status and parsed body. */
export async function call(base: string, method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON (Express default 404) */ }
  return { status: res.status, body: json };
}
