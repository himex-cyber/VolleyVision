import assert from 'node:assert/strict';
import { isOutOfOrder } from './offlineOrder';

const t = (s: number) => new Date(Date.UTC(2026, 8, 29, 10, 0, s));

// Nothing recorded yet: always in order.
assert.equal(isOutOfOrder(t(5), null, null), false);

// Events: strictly earlier is out of order; a tie is not (buildTimeline keeps
// the stable order, and the new row sorts after the existing one).
assert.equal(isOutOfOrder(t(4), t(5), null), true);
assert.equal(isOutOfOrder(t(5), t(5), null), false);
assert.equal(isOutOfOrder(t(6), t(5), null), false);

// Adjustments: a tie IS out of order, because buildTimeline puts events before
// adjustments at the same timestamp, so the new event belongs before it.
assert.equal(isOutOfOrder(t(5), null, t(5)), true);
assert.equal(isOutOfOrder(t(4), null, t(5)), true);
assert.equal(isOutOfOrder(t(6), null, t(5)), false);

// Both: either condition is enough.
assert.equal(isOutOfOrder(t(6), t(7), t(1)), true);
assert.equal(isOutOfOrder(t(6), t(1), t(6)), true);
assert.equal(isOutOfOrder(t(8), t(7), t(6)), false);

console.log('offlineOrder.test.ts passed');
