import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  enqueueCreate, enqueueDelete, resetSending, nextSend, markSending, applyBatchResults,
  rejectItems, removeItem, retryItem, undoNewest, queueSummary, provisionalScore,
  MAX_QUEUE, MAX_BATCH,
} from './eventQueueCore';
import type { QueueItem } from './eventQueueCore';

let n = 0;
const key = () => `new-${++n}`;
const tap = (k: string, eventType = 'KILL', isOpponentEvent = false, t = 0) =>
  ({ clientKey: k, matchId: 'm1', payload: { eventType, setNumber: 1, isOpponentEvent }, recordedAt: new Date(Date.UTC(2026, 8, 29, 10, 0, t)).toISOString() });
const build = (...taps: ReturnType<typeof tap>[]) => taps.reduce<QueueItem[]>((q, t) => enqueueCreate(q, t)!, []);

// Enqueue appends queued creates in order.
let q = build(tap('a'), tap('b'), tap('c'));
assert.deepEqual(q.map((i) => [i.clientKey, i.op, i.state, i.attempts]), [['a', 'create', 'queued', 0], ['b', 'create', 'queued', 0], ['c', 'create', 'queued', 0]]);

// The cap blocks recording rather than dropping anything.
const full = Array.from({ length: MAX_QUEUE }, (_, i) => ({ ...tap(`f${i}`), op: 'create' as const, state: 'queued' as const, attempts: 0 }));
assert.equal(enqueueCreate(full, tap('over')), null);

// nextSend: consecutive queued creates, capped; a delete goes alone; rejected are skipped.
assert.deepEqual((nextSend(q) as any).items.map((i: QueueItem) => i.clientKey), ['a', 'b', 'c']);
const many = build(...Array.from({ length: MAX_BATCH + 5 }, (_, i) => tap(`m${i}`)));
assert.equal((nextSend(many) as any).items.length, MAX_BATCH);
let mixed = enqueueDelete(build(tap('a')), { clientKey: 'd1', matchId: 'm1', serverId: 'e9', recordedAt: tap('x').recordedAt });
mixed = enqueueCreate(mixed, tap('b'))!;
assert.deepEqual((nextSend(mixed) as any).items.map((i: QueueItem) => i.clientKey), ['a'], 'a batch stops at a delete');
mixed = removeItem(mixed, 'a');
assert.equal((nextSend(mixed) as any).item.clientKey, 'd1');
assert.equal(nextSend([]), null);
const withRejected = rejectItems(build(tap('a'), tap('b'), tap('c')), ['b'], 'nope');
assert.deepEqual((nextSend(withRejected) as any).items.map((i: QueueItem) => i.clientKey), ['a', 'c'], 'a rejected tap waits for the user');

// markSending counts attempts; resetSending (load, network error) puts them back.
q = markSending(q, ['a', 'b']);
assert.deepEqual(q.map((i) => [i.state, i.attempts]), [['sending', 1], ['sending', 1], ['queued', 0]]);
q = resetSending(q);
assert.deepEqual(q.map((i) => [i.state, i.attempts]), [['queued', 1], ['queued', 1], ['queued', 0]]);

// applyBatchResults: created/duplicate leave and are synced; rejected wait; retry re-queues.
q = markSending(build(tap('a'), tap('b'), tap('c'), tap('d')), ['a', 'b', 'c', 'd']);
let r = applyBatchResults(q, [
  { clientKey: 'a', status: 'created', serverId: 'e1' },
  { clientKey: 'b', status: 'duplicate', serverId: 'e2' },
  { clientKey: 'c', status: 'rejected', error: 'Unknown event type.' },
  { clientKey: 'd', status: 'retry' },
], key);
assert.deepEqual(r.synced, [{ clientKey: 'a', serverId: 'e1' }, { clientKey: 'b', serverId: 'e2' }]);
assert.deepEqual(r.items.map((i) => [i.clientKey, i.state, i.error]), [['c', 'rejected', 'Unknown event type.'], ['d', 'queued', undefined]]);

// Rejected: Retry puts it back in line; Discard removes it.
assert.equal(retryItem(r.items, 'c')[0].state, 'queued');
assert.equal(retryItem(r.items, 'c')[0].error, undefined);
assert.deepEqual(removeItem(r.items, 'c').map((i) => i.clientKey), ['d']);

// Undo: a never-sent tap is just removed.
q = build(tap('a'), tap('b'));
let u = undoNewest(q);
assert.equal(u.result, 'removed');
assert.deepEqual(u.items.map((i) => i.clientKey), ['a']);

// Undo: a tap in flight (or sent with no answer) is marked, not dropped...
q = markSending(build(tap('a')), ['a']);
u = undoNewest(q);
assert.equal(u.result, 'undo-requested');
assert.equal(u.items[0].undoRequested, true);
assert.equal(undoNewest(resetSending(markSending(build(tap('x')), ['x']))).result, 'undo-requested', 'sent once, no answer: may be on the server');
// ...and once the server confirms it, a delete takes its place.
r = applyBatchResults(u.items, [{ clientKey: 'a', status: 'created', serverId: 'e7' }], key);
assert.deepEqual(r.synced, [], 'an undone tap is not in the history');
assert.deepEqual(r.items.map((i) => [i.op, i.serverId, i.state]), [['delete', 'e7', 'queued']]);
// An undone tap the server refused needs nothing more.
r = applyBatchResults(u.items, [{ clientKey: 'a', status: 'rejected', error: 'x' }], key);
assert.deepEqual(r.items, []);

// Undo skips deletes, already-undone and rejected taps; nothing left is 'none'.
q = rejectItems(build(tap('a'), tap('b')), ['b'], 'x');
assert.deepEqual(undoNewest(q).items.map((i) => i.clientKey), ['b'], 'the rejected tap stays; a goes');
assert.equal(undoNewest(enqueueDelete([], { clientKey: 'd', matchId: 'm1', serverId: 'e', recordedAt: '' })).result, 'none');
assert.equal(undoNewest([]).result, 'none');

// An answer still applies if another tab's reload reset the item to queued.
r = applyBatchResults(resetSending(markSending(build(tap('a')), ['a'])), [{ clientKey: 'a', status: 'created', serverId: 'e1' }], key);
assert.deepEqual([r.items.length, r.synced.length], [0, 1]);

// A response missing an item (never expected) leaves it queued, not lost.
r = applyBatchResults(markSending(build(tap('a'), tap('b')), ['a', 'b']), [{ clientKey: 'a', status: 'created', serverId: 'e1' }], key);
assert.deepEqual(r.items.map((i) => [i.clientKey, i.state]), [['b', 'queued']]);

assert.deepEqual(queueSummary(rejectItems(build(tap('a'), tap('b'), tap('c')), ['a'], 'x')), { waiting: 2, rejected: 1 });

// ─── provisionalScore ───────────────────────────────────────────────────────
const server = { homeScore: 10, awayScore: 8, homeSetsWon: 0, awaySetsWon: 0, setScores: [] };
// Queued taps add on top of the server, opponent events for them.
let p = provisionalScore(server, [], build(tap('a', 'KILL'), tap('b', 'KILL', true), tap('c', 'DIG')));
assert.deepEqual([p.homeScore, p.awayScore, p.provisional], [11, 9, true]);
// A tap the server already applied (still marked sending) doesn't count twice.
p = provisionalScore(server, [{ id: 'e1', clientKey: 'a', eventType: 'KILL', isOpponentEvent: false }], markSending(build(tap('a')), ['a']));
assert.deepEqual([p.homeScore, p.awayScore], [10, 8]);
// Rejected taps don't count.
p = provisionalScore(server, [], rejectItems(build(tap('a')), ['a'], 'x'));
assert.deepEqual([p.homeScore, p.provisional], [10, false]);
// Pending deletes and undone-but-applied taps come off.
const del = enqueueDelete([], { clientKey: 'd', matchId: 'm1', serverId: 'e5', recordedAt: '' });
p = provisionalScore(server, [{ id: 'e5', clientKey: null, eventType: 'ACE', isOpponentEvent: false }], del);
assert.deepEqual([p.homeScore, p.awayScore], [9, 8]);
const undone = undoNewest(markSending(build(tap('a', 'KILL', true)), ['a'])).items;
p = provisionalScore(server, [{ id: 'e1', clientKey: 'a', eventType: 'KILL', isOpponentEvent: true }], undone);
assert.deepEqual([p.homeScore, p.awayScore], [10, 7]);
// An undone tap the server doesn't have yet simply doesn't count.
p = provisionalScore(server, [], undoNewest(markSending(build(tap('a')), ['a'])).items);
assert.deepEqual([p.homeScore, p.awayScore], [10, 8]);
// Set completion is provisional too, in time order.
p = provisionalScore({ ...server, homeScore: 24, awayScore: 20 }, [], build(tap('late', 'KILL', false, 9), tap('early', 'KILL', true, 1)));
assert.deepEqual([p.homeSetsWon, p.setScores], [1, [{ set: 1, home: 25, away: 21 }]]);
// Nothing queued: exactly the server's state.
p = provisionalScore(server, [], []);
assert.deepEqual([p.homeScore, p.awayScore, p.provisional], [10, 8, false]);

// The frontend copy (no test runner there) must match from the marker down.
const logic = (file: string) => {
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const marker = "import { scoringTeam } from './scoringRules';";
  assert.ok(src.includes(marker), `${file} lost its marker`);
  return src.slice(src.indexOf(marker));
};
assert.equal(
  logic(path.join(__dirname, '../../../frontend/src/lib/eventQueueCore.ts')),
  logic(path.join(__dirname, 'eventQueueCore.ts')),
  'frontend/src/lib/eventQueueCore.ts has drifted from the tested backend copy',
);

console.log('eventQueueCore.test.ts passed');
