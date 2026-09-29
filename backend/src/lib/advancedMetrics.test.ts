import assert from 'node:assert/strict';
import { buildAdvancedMetrics } from './advancedMetrics';

const own = (eventType: string, setNumber = 1) => ({ eventType, setNumber });
const ours = [
  own('PASS_3'), own('PASS_3'), own('PASS_2'), own('PASS_1'), own('PASS_0'),     // 5 passes, 3 graded 2+ (60%), 2 perfect (40%)
  own('ACE'), own('SERVICE_ERROR'), own('SERVE_IN'), own('SERVE_IN', 2),          // 4 serves: ace 25%, error 25%, in-or-ace 75%
  own('KILL'), own('KILL'), own('ATTACK_ERROR'), own('ATTACK_ATTEMPT'), own('TIP', 2), // 5 attacks: kill 40%, hitting .200
  own('SOLO_BLOCK', 2), own('BLOCK_ASSIST', 2), own('BLOCK_ASSIST', 2),            // 2 blocks over 2 sets = 1.0
];
const points = [
  { eventType: 'KILL', isOpponentEvent: false, servingSide: 'THEM' as const, rotationNumber: 1 },
  { eventType: 'KILL', isOpponentEvent: true, servingSide: 'THEM' as const, rotationNumber: 1 },
  { eventType: 'ACE', isOpponentEvent: false, servingSide: 'US' as const, rotationNumber: 2 },
  { eventType: 'KILL', isOpponentEvent: false, servingSide: null, rotationNumber: 2 },
];

const m = buildAdvancedMetrics(ours, points);

// Renamed from the old "sideOut": this is pass quality, not side-out.
assert.deepEqual(m.receptionQuality, { attempts: 5, qualityPasses: 3, qualityPct: 60, perfectPassRate: 40, pass3: 2, pass2: 1, pass1: 1, pass0: 1 });
assert.deepEqual(m.serve, { attempts: 4, aces: 1, errors: 1, aceRate: 25, errorRate: 25, positiveRate: 75 });
assert.deepEqual(m.attack, { attempts: 5, kills: 2, errors: 1, killRate: 40, hittingPct: 0.2 });
assert.deepEqual(m.blocking, { soloBlocks: 1, blockAssists: 2, totalBlocks: 2, blocksPerSet: 1 });
assert.equal(m.setsPlayed, 2);
// Real side-out and break-point, from the opponent-inclusive list with a serving side.
assert.deepEqual(m.sideOut, { sideOutPct: 50, breakPointPct: 100, receiveRallies: 2, serveRallies: 1, coverage: { withServingSide: 3, totalPoints: 4 } });
assert.ok(!('sideOutEfficiency' in m), 'the misleading old label is gone');

// Nothing recorded: every rate null, never NaN.
const empty = buildAdvancedMetrics([], []);
assert.deepEqual([empty.receptionQuality.qualityPct, empty.serve.aceRate, empty.attack.hittingPct, empty.blocking.blocksPerSet, empty.sideOut.sideOutPct], [null, null, null, null, null]);

// Team scope: set 1 of two matches is two sets, not one.
const team = buildAdvancedMetrics(
  [{ eventType: 'SOLO_BLOCK', setNumber: 1, matchId: 'a' }, { eventType: 'SOLO_BLOCK', setNumber: 1, matchId: 'b' }],
  [],
);
assert.deepEqual([team.setsPlayed, team.blocking.blocksPerSet], [2, 1]);

console.log('advancedMetrics.test.ts passed');
