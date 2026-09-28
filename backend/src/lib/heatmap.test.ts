// Tests the real buildDetailedHeatmap (the pre-removal version only tested an
// inline copy of it).
import assert from 'node:assert/strict';
import { buildDetailedHeatmap } from './heatmap';

const ev = (eventType: string, courtZone: number | null) => ({ eventType, courtZone });
const ZONES = ['1', '2', '3', '4', '5', '6'];

// Empty: all six zones present and zero-filled, nulls not NaN.
const empty = buildDetailedHeatmap([]);
for (const category of ['attack', 'serve', 'pass', 'defence'] as const) {
  assert.deepEqual(Object.keys(empty[category]).sort(), ZONES, `${category} has all six zones`);
}
assert.deepEqual(empty.attack['4'], { kills: 0, errors: 0, attempts: 0, hittingPct: null });
assert.deepEqual(empty.serve['1'], { aces: 0, errors: 0, serveIn: 0, attempts: 0, efficiency: null });
assert.deepEqual(empty.pass['6'], { pass3: 0, pass2: 0, pass1: 0, pass0: 0, attempts: 0, rating: null });
assert.deepEqual(empty.defence['5'], { digs: 0, soloBlocks: 0, blockAssists: 0, total: 0 });
assert.deepEqual(empty.coverage, { tagged: 0, total: 0 });

// Attack: hitting % = (kills - errors) / attempts; tips and free balls are attempts.
const attack = buildDetailedHeatmap([
  ev('KILL', 4), ev('KILL', 4), ev('ATTACK_ERROR', 4), ev('ATTACK_ATTEMPT', 4),
  ev('TIP', 4), ev('FREE_BALL', 4), ev('KILL', 2),
]).attack;
assert.deepEqual(attack['4'], { kills: 2, errors: 1, attempts: 6, hittingPct: 0.167 });
assert.deepEqual(attack['2'], { kills: 1, errors: 0, attempts: 1, hittingPct: 1 });

// Serve: efficiency = (aces - errors) / attempts.
const serve = buildDetailedHeatmap([ev('ACE', 1), ev('SERVICE_ERROR', 1), ev('SERVE_IN', 1), ev('SERVE_IN', 1)]).serve;
assert.deepEqual(serve['1'], { aces: 1, errors: 1, serveIn: 2, attempts: 4, efficiency: 0 });

// Pass: rating on the 0-3 scale.
const pass = buildDetailedHeatmap([ev('PASS_3', 6), ev('PASS_3', 6), ev('PASS_1', 6), ev('PASS_0', 6)]).pass;
assert.deepEqual(pass['6'], { pass3: 2, pass2: 0, pass1: 1, pass0: 1, attempts: 4, rating: 1.75 });

// Defence: digs + blocks.
const defence = buildDetailedHeatmap([ev('DIG', 5), ev('DIG', 5), ev('SOLO_BLOCK', 5), ev('BLOCK_ASSIST', 5)]).defence;
assert.deepEqual(defence['5'], { digs: 2, soloBlocks: 1, blockAssists: 1, total: 4 });

// Null and out-of-range zones are skipped, and counted as untagged. Types the
// map doesn't show (ASSIST, BLOCK_ERROR...) count in neither.
const mixed = buildDetailedHeatmap([
  ev('KILL', 3), ev('KILL', null), ev('KILL', 0), ev('KILL', 7), ev('DIG', 1), ev('ASSIST', 2), ev('BLOCK_ERROR', null),
]);
assert.equal(mixed.attack['3'].kills, 1);
assert.equal(Object.values(mixed.attack).reduce((n, z) => n + z.kills, 0), 1, 'only the valid zone counts');
assert.deepEqual(mixed.coverage, { tagged: 2, total: 5 });

console.log('heatmap.test.ts passed');
