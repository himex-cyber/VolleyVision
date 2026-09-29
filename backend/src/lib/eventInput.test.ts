import assert from 'node:assert/strict';
import { parseEventInput } from './eventInput';

function status(fn: () => unknown): number | 'ok' {
  try { fn(); return 'ok'; } catch (err: any) { return err.statusCode; }
}
function message(fn: () => unknown): string {
  try { fn(); return ''; } catch (err: any) { return err.message; }
}

const base = { matchId: 'm1', playerId: 'p1', eventType: 'KILL', setNumber: 2 };

// A normal own-team event.
assert.deepEqual(parseEventInput(base), {
  matchId: 'm1', playerId: 'p1', eventType: 'KILL', setNumber: 2,
  rallyNumber: null, courtZone: null, rotationNumber: null, notes: null,
  isOpponentEvent: false, opponentJerseyNumber: null, recordedAt: undefined,
});
// Strings from a form still parse, as today.
assert.equal(parseEventInput({ ...base, setNumber: '3', courtZone: '4', rotationNumber: '6' }).courtZone, 4);
// An opponent event: no player, optional jersey.
const opp = parseEventInput({ matchId: 'm1', eventType: 'ACE', setNumber: 1, isOpponentEvent: true, opponentJerseyNumber: '7' });
assert.equal(opp.playerId, null);
assert.equal(opp.isOpponentEvent, true);
assert.equal(opp.opponentJerseyNumber, 7);
// recordedAt passes through untouched; clientTime decides later.
assert.equal(parseEventInput({ ...base, recordedAt: '2026-09-29T10:00:00Z' }).recordedAt, '2026-09-29T10:00:00Z');

// Required fields, as today.
assert.equal(status(() => parseEventInput({ ...base, matchId: undefined })), 400);
assert.equal(status(() => parseEventInput({ ...base, eventType: undefined })), 400);
assert.equal(status(() => parseEventInput({ ...base, setNumber: undefined })), 400);
assert.equal(status(() => parseEventInput({ ...base, playerId: undefined })), 400, 'own events need a player');
assert.equal(status(() => parseEventInput({ ...base, isOpponentEvent: true })), 400, 'opponent events have no player');
assert.equal(status(() => parseEventInput(null)), 400);

// New: an unknown event type is a 400, not a Prisma 500.
assert.equal(message(() => parseEventInput({ ...base, eventType: 'SPIKE' })), 'Unknown event type.');
assert.equal(status(() => parseEventInput({ ...base, eventType: 'toString' })), 400, 'prototype keys are not event types');
assert.equal(status(() => parseEventInput({ ...base, eventType: 5 })), 400);

// New: setNumber is an integer 1–5.
for (const bad of ['x', 0, 6, 2.5, -1, '']) {
  assert.equal(status(() => parseEventInput({ ...base, setNumber: bad })), 400, `setNumber ${JSON.stringify(bad)}`);
}
assert.equal(parseEventInput({ ...base, setNumber: 5 }).setNumber, 5);

// Zone and rotation, as today.
assert.equal(status(() => parseEventInput({ ...base, courtZone: 7 })), 400);
assert.equal(status(() => parseEventInput({ ...base, rotationNumber: 0 })), 400);

// Fields that used to reach Prisma as a 500 (which would stall a batch).
assert.equal(status(() => parseEventInput({ ...base, matchId: { id: 'm1' } })), 400);
assert.equal(status(() => parseEventInput({ ...base, playerId: 42 })), 400);
assert.equal(status(() => parseEventInput({ ...base, rallyNumber: 'x' })), 400);
assert.equal(status(() => parseEventInput({ ...base, notes: { a: 1 } })), 400);
assert.equal(status(() => parseEventInput({ ...base, notes: 'n'.repeat(501) })), 400);
assert.equal(status(() => parseEventInput({ ...base, notes: 'a\0b' })), 400, 'NUL');
assert.equal(status(() => parseEventInput({ ...base, playerId: 'p\0' })), 400, 'NUL');
assert.equal(status(() => parseEventInput({ matchId: 'm1', eventType: 'ACE', setNumber: 1, isOpponentEvent: true, opponentJerseyNumber: 'x' })), 400);
assert.equal(parseEventInput({ ...base, rallyNumber: 12, notes: 'ok' }).rallyNumber, 12);

console.log('eventInput.test.ts passed');
