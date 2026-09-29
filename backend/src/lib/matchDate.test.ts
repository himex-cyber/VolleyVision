// 8.0.7: a match's date is the fixture's wall-clock time. The web forms send
// a naive datetime-local string; it used to be parsed in the SERVER's time
// zone (UTC on Netlify, NZ on a dev machine), so the same entry was stored
// differently, and an invalid one reached Prisma as a 500.
import assert from 'node:assert/strict';
import { parseMatchDate } from './matchDate';

const iso = (v: unknown) => parseMatchDate(v)?.toISOString() ?? null;

// Naive values are stored as written, whatever the server's zone.
assert.equal(iso('2026-09-30T19:00'), '2026-09-30T19:00:00.000Z');
assert.equal(iso('2026-09-30T19:00:30'), '2026-09-30T19:00:30.000Z');
assert.equal(iso('2026-09-30T19:00:30.250'), '2026-09-30T19:00:30.250Z');

// An explicit zone parses as before (installed apps and API callers).
assert.equal(iso('2026-09-30T19:00:00.000Z'), '2026-09-30T19:00:00.000Z');
assert.equal(iso('2026-09-30T19:00+13:00'), '2026-09-30T06:00:00.000Z');
// A plain date, as before: midnight UTC.
assert.equal(iso('2026-09-30'), '2026-09-30T00:00:00.000Z');

// Not a date, or not a real one: null (the controller answers 400).
for (const bad of ['x', '', '2026-02-30T10:00', '2026-13-01T10:00', '2026-09-30T24:30', '0002-09-30T10:00', null, undefined, 20260930, {}, ['2026-09-30T19:00']]) {
  assert.equal(parseMatchDate(bad), null, JSON.stringify(bad));
}

console.log('matchDate tests passed.');
