// Regression tests for middleware/auth.ts requireAuth — the token-revocation
// check (audit M7 part 2) and the fix that DB errors reach next(err) instead
// of hanging the request until the Lambda times out.
import assert from 'node:assert/strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

import { db, resetDb } from '../testing/installFakePrisma';
import { requireAuth } from '../middleware/auth';
import { generateToken } from '../services/auth.service';

function fakeRes() {
  const res: any = { statusCode: null, body: null };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  return res;
}

function makeNext() {
  const calls: unknown[] = [];
  const next = (err?: unknown) => { calls.push(err); };
  return { next, calls };
}

async function noHeaderIs401() {
  resetDb();
  const req: any = { headers: {} };
  const res = fakeRes();
  const { next, calls } = makeNext();
  await requireAuth(req, res, next);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0, 'must not call next() on missing auth header');
}

async function badSignatureIs401() {
  resetDb();
  const token = generateToken({ userId: 'u1', email: 'a@b.com', role: 'PLAYER', tv: 0 });
  const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
  const req: any = { headers: { authorization: `Bearer ${tampered}` } };
  const res = fakeRes();
  const { next, calls } = makeNext();
  await requireAuth(req, res, next);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Invalid or expired token.');
  assert.equal(calls.length, 0);
}

async function matchingTvCallsNext() {
  resetDb();
  db.user.findUnique = async () => ({ tokenVersion: 3 });
  const token = generateToken({ userId: 'u1', email: 'a@b.com', role: 'PLAYER', tv: 3 });
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  const res = fakeRes();
  const { next, calls } = makeNext();
  await requireAuth(req, res, next);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], undefined, 'next() must be called with no error');
  assert.equal(res.statusCode, null, 'must not have responded');
  assert.equal(req.user.userId, 'u1');
}

async function staleTvIs401SessionExpired() {
  resetDb();
  db.user.findUnique = async () => ({ tokenVersion: 5 }); // DB is ahead of the token
  const token = generateToken({ userId: 'u1', email: 'a@b.com', role: 'PLAYER', tv: 3 });
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  const res = fakeRes();
  const { next, calls } = makeNext();
  await requireAuth(req, res, next);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Session expired. Sign in again.');
  assert.equal(calls.length, 0);
}

async function missingTvClaimTreatedAsZero() {
  resetDb();
  db.user.findUnique = async () => ({ tokenVersion: 0 });
  // A pre-M7 token: no tv claim at all.
  const token = generateToken({ userId: 'u1', email: 'a@b.com', role: 'PLAYER' } as any);
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  const res = fakeRes();
  const { next, calls } = makeNext();
  await requireAuth(req, res, next);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], undefined);
  assert.equal(res.statusCode, null);
}

async function dbErrorReachesNextNotAHang() {
  resetDb();
  const dbErr = new Error('connection lost');
  db.user.findUnique = async () => { throw dbErr; };
  const token = generateToken({ userId: 'u1', email: 'a@b.com', role: 'PLAYER', tv: 0 });
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  const res = fakeRes();
  const { next, calls } = makeNext();
  await requireAuth(req, res, next);
  assert.equal(res.statusCode, null, 'a DB error must not be turned into a 401');
  assert.equal(calls.length, 1);
  assert.equal(calls[0], dbErr, 'the DB error must reach next() so the error handler can 500 it');
}

async function main() {
  await noHeaderIs401();
  await badSignatureIs401();
  await matchingTvCallsNext();
  await staleTvIs401SessionExpired();
  await missingTvClaimTreatedAsZero();
  await dbErrorReachesNextNotAHang();
  console.log('auth.test.ts passed');
}

main();
