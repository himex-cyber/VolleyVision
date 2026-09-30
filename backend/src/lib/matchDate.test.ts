// 8.0.7: a match's date is the fixture's wall-clock time. The web forms send
// a naive datetime-local string; it used to be parsed in the SERVER's time
// zone (UTC on Netlify, NZ on a dev machine), so the same entry was stored
// differently, and an invalid one reached Prisma as a 500.
import assert from 'node:assert/strict';
import { parseMatchDate, upcomingFrom } from './matchDate';

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

// 9.0.6: "upcoming" is judged against the device's wall-clock time, sent as a
// naive localNow, since match dates are fixture wall-clock time stored as UTC.
{
  const now = new Date('2026-09-30T07:00:00Z'); // 20:00 in NZ (UTC+13)
  const from = upcomingFrom('2026-09-30T20:00', now);
  assert.equal(from.toISOString(), '2026-09-30T20:00:00.000Z', 'the local wall clock, as stored dates are');
  assert.ok(new Date('2026-09-30T19:00:00Z') < from, 'a 19:00 match is no longer upcoming at 20:00 local');
  for (const ignored of ['2026-09-30T20:00Z', '2026-09-30T20:00+13:00', '2026-09-30T21:01', '2026-09-29T16:59', 'soon', '', undefined, ['2026-09-30T20:00']]) {
    assert.equal(upcomingFrom(ignored, now), now, `ignored: ${JSON.stringify(ignored)}`);
  }
  assert.equal(upcomingFrom('2026-09-30T21:00', now).toISOString(), '2026-09-30T21:00:00.000Z', '+14 h is the edge');
  assert.equal(upcomingFrom('2026-09-29T17:00', now).toISOString(), '2026-09-29T17:00:00.000Z', '-14 h is the edge');
}

console.log('matchDate tests passed.');
