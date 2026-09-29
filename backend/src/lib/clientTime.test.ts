import assert from 'node:assert/strict';
import { acceptClientRecordedAt } from './clientTime';

const now = new Date('2026-09-29T10:00:00.000Z');
const matchCreatedAt = new Date('2026-09-29T08:00:00.000Z');
const opts = { now, matchCreatedAt };

// Accepted: an ISO time between the match's creation and 2 minutes from now.
const ok = acceptClientRecordedAt('2026-09-29T09:30:00.000Z', opts);
assert.equal(ok.reason, 'accepted');
assert.equal(ok.recordedAt?.toISOString(), '2026-09-29T09:30:00.000Z');
const ahead = acceptClientRecordedAt('2026-09-29T10:02:00.000Z', opts);
assert.equal(ahead.reason, 'accepted', 'exactly 2 min ahead is allowed');
assert.equal(ahead.recordedAt?.toISOString(), now.toISOString(), '...but clamped to now');
assert.equal(acceptClientRecordedAt('2026-09-29T08:00:00.000Z', opts).reason, 'accepted', 'exactly the creation time is allowed');
assert.equal(acceptClientRecordedAt('2026-09-29T10:00:00+13:00', opts).reason, 'too-early', 'offsets are honoured');

// Absent: old apps send nothing. The server uses now().
const none = acceptClientRecordedAt(undefined, opts);
assert.deepEqual(none, { recordedAt: null, reason: 'absent' });
assert.equal(acceptClientRecordedAt(null, opts).reason, 'absent');

// Rejected (never an error: a phone with a wrong clock must still save).
assert.deepEqual(acceptClientRecordedAt('2026-09-29T10:02:00.001Z', opts), { recordedAt: null, reason: 'too-late' });
assert.deepEqual(acceptClientRecordedAt('2026-09-29T07:59:59.999Z', opts), { recordedAt: null, reason: 'too-early' });
assert.equal(acceptClientRecordedAt('yesterday', opts).reason, 'invalid');
assert.equal(acceptClientRecordedAt('2026-09-29', opts).reason, 'invalid', 'a date without a time is not an ISO timestamp');
assert.equal(acceptClientRecordedAt('2026-09-29T09:30Z', opts).reason, 'invalid', 'seconds are required');
assert.equal(acceptClientRecordedAt(1790000000000, opts).reason, 'invalid', 'numbers are not accepted');
assert.equal(acceptClientRecordedAt('2026-02-31T10:00:00Z', opts).reason, 'invalid', 'an impossible date');

console.log('clientTime.test.ts passed');
