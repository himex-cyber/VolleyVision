import assert from 'node:assert/strict';
import { calculateSideOut } from './sideOut';
import type { PointEvent } from './sideOut';

const pt = (eventType: string, servingSide: 'US' | 'THEM' | null, rotationNumber: number | null = null, isOpponentEvent = false): PointEvent =>
  ({ eventType, servingSide, rotationNumber, isOpponentEvent });

// A hand-built set, answer worked out by hand:
//   Them serving (receive rallies): KILL (won, side-out), ATTACK_ERROR (lost),
//     opponent ACE (lost), opponent SERVICE_ERROR (won, side-out)  → 2 of 4 = 50%
//   Us serving (serve rallies): ACE (won, break point), SERVICE_ERROR (lost),
//     SOLO_BLOCK (won, break point)                                 → 2 of 3 = 66.7%
const set = [
  pt('KILL', 'THEM', 1),
  pt('ATTACK_ERROR', 'THEM', 1),
  pt('ACE', 'THEM', 2, true),
  pt('SERVICE_ERROR', 'THEM', 2, true),
  pt('ACE', 'US', 3),
  pt('SERVICE_ERROR', 'US', 3),
  pt('SOLO_BLOCK', 'US', 3),
  pt('DIG', 'US', 3), // no point: ignored entirely
];
const r = calculateSideOut(set);
assert.deepEqual(
  { sideOutPct: r.sideOutPct, breakPointPct: r.breakPointPct, receiveRallies: r.receiveRallies, serveRallies: r.serveRallies, sideOuts: r.sideOuts, breakPoints: r.breakPoints },
  { sideOutPct: 50, breakPointPct: 66.7, receiveRallies: 4, serveRallies: 3, sideOuts: 2, breakPoints: 2 },
);
assert.deepEqual(r.coverage, { withServingSide: 7, totalPoints: 7 });

// Per rotation 1–6, always all six.
assert.equal(r.byRotation.length, 6);
const rot = (n: number) => r.byRotation.find((x) => x.rotation === n)!;
assert.deepEqual([rot(1).sideOutPct, rot(1).receiveRallies, rot(1).serveRallies], [50, 2, 0]);
assert.deepEqual([rot(2).sideOutPct, rot(2).receiveRallies], [50, 2]);
assert.deepEqual([rot(3).breakPointPct, rot(3).serveRallies, rot(3).sideOutPct], [66.7, 3, null]);
assert.deepEqual([rot(4).sideOutPct, rot(4).breakPointPct, rot(4).receiveRallies], [null, null, 0]);

// Points with no serving side (older apps, manual score) are excluded and counted in coverage.
const mixed = calculateSideOut([...set, pt('KILL', null, 1), pt('ATTACK_ERROR', null)]);
assert.equal(mixed.sideOutPct, 50, 'unknown serving side changes nothing');
assert.deepEqual(mixed.coverage, { withServingSide: 7, totalPoints: 9 });

// A point with a serving side but no rotation counts overall, not per rotation.
const noRot = calculateSideOut([pt('KILL', 'THEM', null)]);
assert.equal(noRot.sideOutPct, 100);
assert.ok(noRot.byRotation.every((x) => x.receiveRallies === 0));

// Nothing tracked.
const empty = calculateSideOut([]);
assert.deepEqual([empty.sideOutPct, empty.breakPointPct, empty.coverage.totalPoints], [null, null, 0]);

console.log('sideOut.test.ts passed');
