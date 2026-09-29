// 8.1: the from/to date range on the matches list and the cross-match
// analytics routes. UTC days, whole end day included, anything odd is a 400
// message (never a Prisma error and a 500).
import assert from 'node:assert/strict';
import { parseDateWindow, matchDateWhere } from './dateWindow';

const FORMAT = 'Dates must look like 2026-09-30.';
const ok = (q: { from?: unknown; to?: unknown }) => {
  const r = parseDateWindow(q);
  assert.ok(r.ok, JSON.stringify(r));
  return r.window;
};
const err = (q: { from?: unknown; to?: unknown }) => {
  const r = parseDateWindow(q);
  assert.ok(!r.ok, `expected an error for ${JSON.stringify(q)}`);
  return r.message;
};

// Neither: today's behaviour.
assert.equal(ok({}), null);
assert.equal(ok({ from: undefined, to: undefined }), null);
assert.deepEqual(matchDateWhere(null), {});

// Both: from's midnight to the midnight after `to`.
const both = ok({ from: '2026-09-01', to: '2026-09-30' })!;
assert.deepEqual(both, { gte: new Date('2026-09-01T00:00:00.000Z'), lt: new Date('2026-10-01T00:00:00.000Z') });
assert.deepEqual(matchDateWhere(both), { matchDate: both });

// The whole end day is in: 23:59:59.999 on the 30th is < lt.
assert.ok(new Date('2026-09-30T23:59:59.999Z') < both.lt!);
assert.ok(!(new Date('2026-10-01T00:00:00.000Z') < both.lt!));

// One side only.
assert.deepEqual(ok({ from: '2026-09-01' }), { gte: new Date('2026-09-01T00:00:00.000Z') });
assert.deepEqual(ok({ to: '2026-12-31' }), { lt: new Date('2027-01-01T00:00:00.000Z') }, 'year rollover');
assert.deepEqual(ok({ to: '2028-02-28' }), { lt: new Date('2028-02-29T00:00:00.000Z') }, 'leap year');

// A single day.
assert.deepEqual(ok({ from: '2026-09-30', to: '2026-09-30' }), { gte: new Date('2026-09-30T00:00:00.000Z'), lt: new Date('2026-10-01T00:00:00.000Z') });

// Invalid formats: only YYYY-MM-DD.
for (const bad of ['x', '2026-9-30', '30/09/2026', '2026-09-30T00:00:00Z', ' 2026-09-30', '20260930', '', 20260930, {}, null]) {
  assert.equal(err({ from: bad }), FORMAT, `from=${JSON.stringify(bad)}`);
  assert.equal(err({ to: bad }), FORMAT, `to=${JSON.stringify(bad)}`);
}

// Repeated params arrive as arrays.
assert.equal(err({ from: ['2026-09-01', '2026-09-02'] }), FORMAT);

// Impossible dates are refused, not rolled over.
for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2027-02-29']) {
  assert.equal(err({ from: bad }), FORMAT, bad);
}
assert.ok(ok({ from: '2028-02-29' }), 'a real leap day is fine');

// Years outside 1900-9998: Date.UTC reads 0002 as 1902 (the client's date
// library disagrees, so it would send a date the server refuses), and
// 9999-12-31's end is year 10000, which Postgres can't store (a 500).
for (const bad of ['0002-09-01', '0099-01-01', '1899-12-31', '9999-12-31']) {
  assert.equal(err({ to: bad }), FORMAT, bad);
}
assert.ok(ok({ from: '1900-01-01', to: '9998-12-31' }), 'the edges are fine');

// from after to.
assert.equal(err({ from: '2026-09-30', to: '2026-09-01' }), 'The start date is after the end date.');

console.log('dateWindow tests passed.');
