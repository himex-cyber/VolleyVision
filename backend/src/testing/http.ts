// Shared by src/__tests__/http.*.test.ts: the whole Express app on a random
// port, and a signed token for a fake user. Import installFakePrisma BEFORE
// this file, so the app never constructs a real PrismaClient.
import './testEnv'; // must precede ../index
import http from 'http';
import { AddressInfo } from 'net';
import app from '../index';
import { generateToken } from '../services/auth.service';

export async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** A token requireAuth accepts, provided the fake user.findUnique returns tokenVersion 0. */
export function tokenFor(userId: string): string {
  return generateToken({ userId, email: `${userId}@example.test`, role: 'COACH', tv: 0 });
}

export async function send(base: string, method: string, path: string, token?: string, body?: unknown): Promise<number> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  await res.text();
  return res.status;
}
