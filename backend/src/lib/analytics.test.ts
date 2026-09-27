import assert from 'node:assert/strict';
import { EventType } from '@prisma/client';
import { calculateStats } from './analytics';

const events = [
  EventType.KILL,
  EventType.KILL,
  EventType.ATTACK_ERROR,
  EventType.ATTACK_ATTEMPT,
  EventType.ACE,
  EventType.SERVICE_ERROR,
  EventType.SERVE_IN,
  EventType.PASS_3,
  EventType.PASS_2,
  EventType.PASS_1,
  EventType.PASS_0,
  EventType.SOLO_BLOCK,
  EventType.BLOCK_ASSIST,
].map((eventType) => ({ eventType, playerId: 'player-1', setNumber: 1 }));

const stats = calculateStats(events);

assert.equal(stats.attackAttempts, 4);
assert.equal(stats.hittingPercentage, 0.25);
assert.equal(stats.serveAttempts, 3);
assert.equal(stats.serveInPercentage, 0.667);
assert.equal(stats.passAttempts, 4);
assert.equal(stats.passingRating, 1.5);
assert.equal(stats.totalBlocks, 1.5);

const emptyStats = calculateStats([]);
assert.equal(emptyStats.hittingPercentage, null);
assert.equal(emptyStats.passingRating, null);

// ── TIP and FREE_BALL as attack attempts ──────────────────────────────────────

const tipEvents = [
  EventType.KILL,          // 1 kill
  EventType.ATTACK_ERROR,  // 1 error
  EventType.TIP,           // attempt only
  EventType.TIP,           // attempt only
  EventType.FREE_BALL,     // attempt only
].map((eventType) => ({ eventType, playerId: 'player-1', setNumber: 1 }));

const tipStats = calculateStats(tipEvents);
assert.equal(tipStats.tips, 2, 'tips counter should be 2');
assert.equal(tipStats.freeBalls, 1, 'freeBalls counter should be 1');
assert.equal(tipStats.attackAttempts, 5, 'TIP and FREE_BALL must count as attack attempts');
// hitting % = (1 kill - 1 error) / 5 attempts = 0.000
assert.equal(tipStats.hittingPercentage, 0, 'tips/free balls dilute hitting percentage as attempts');
assert.equal(emptyStats.tips, 0);
assert.equal(emptyStats.freeBalls, 0);

console.log('Analytics formula tests passed.');
