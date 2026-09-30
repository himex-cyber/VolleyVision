import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { replayTimeline, buildTimeline } from './scoreReplay';
import type { ReplayItem } from './scoreReplay';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let clock = 0;
function nextDate() {
  clock += 1000;
  return new Date(clock);
}

function evt(eventType: string, isOpponentEvent = false): ReplayItem {
  return { kind: 'event', eventType, isOpponentEvent, at: nextDate() };
}

function adj(homeDelta: number, awayDelta: number): ReplayItem {
  return { kind: 'adjustment', homeDelta, awayDelta, at: nextDate() };
}

// ─── Core requirement: adjustments survive undo ───────────────────────────────

describe('replayTimeline — manual adjustments survive undo', () => {
  it('adjust → record event → undo → adjusted score survives', () => {
    // Coach adjusts +2 home (e.g. missed points), then a kill is recorded.
    const timeline = [
      evt('KILL'),        // home 1-0
      adj(2, 0),          // home 3-0 (manual correction)
      evt('KILL'),        // home 4-0
    ];

    const full = replayTimeline(timeline);
    assert.equal(full.homeScore, 4);
    assert.equal(full.awayScore, 0);

    // Undo the last kill (recalculate replays the remaining timeline).
    const afterUndo = replayTimeline(timeline.slice(0, -1));
    assert.equal(afterUndo.homeScore, 3, 'adjustment must survive the undo');
    assert.equal(afterUndo.awayScore, 0);
  });

  it('away-side adjustment also survives undo', () => {
    const timeline = [
      evt('ATTACK_ERROR'), // away 0-1
      adj(0, 3),           // away 0-4
      evt('KILL'),         // home 1-4
    ];
    const afterUndo = replayTimeline(timeline.slice(0, -1));
    assert.equal(afterUndo.homeScore, 0);
    assert.equal(afterUndo.awayScore, 4, 'away adjustment must survive the undo');
  });

  it('negative adjustment (score correction downward) survives undo', () => {
    const timeline = [
      evt('KILL'), evt('KILL'), evt('KILL'), // home 3-0
      adj(-1, 0),                            // home 2-0 (correcting a mistaken point)
      evt('ATTACK_ERROR'),                   // away 2-1
    ];
    const afterUndo = replayTimeline(timeline.slice(0, -1));
    assert.equal(afterUndo.homeScore, 2, 'downward correction must survive');
    assert.equal(afterUndo.awayScore, 0);
  });
});

// ─── Adjustment mechanics ─────────────────────────────────────────────────────

describe('replayTimeline — adjustment mechanics', () => {
  it('adjustment can never push a score below zero', () => {
    const result = replayTimeline([evt('KILL'), adj(-5, -5)]);
    assert.equal(result.homeScore, 0);
    assert.equal(result.awayScore, 0);
  });

  it('an adjustment can complete a set', () => {
    // 24-0, then +1 home via adjustment → 25-0 set win, scores reset
    const timeline: ReplayItem[] = [
      ...Array.from({ length: 24 }, () => evt('KILL')),
      adj(1, 0),
    ];
    const result = replayTimeline(timeline);
    assert.equal(result.homeSetsWon, 1, 'adjustment must be able to complete a set');
    assert.equal(result.homeScore, 0, 'score resets after set win');
    assert.deepEqual(result.setScores, [{ set: 1, home: 25, away: 0 }]);
  });

  it('zero-delta adjustment changes nothing', () => {
    const result = replayTimeline([evt('KILL'), adj(0, 0)]);
    assert.equal(result.homeScore, 1);
    assert.equal(result.awayScore, 0);
  });

  it('opponent events and adjustments compose correctly', () => {
    const timeline = [
      evt('KILL', true),          // opponent kill → away 0-1
      evt('SERVICE_ERROR', true), // opponent error → home 1-1
      adj(1, 0),                  // home 2-1
    ];
    const result = replayTimeline(timeline);
    assert.equal(result.homeScore, 2);
    assert.equal(result.awayScore, 1);
  });
});

// ─── Timeline merging ─────────────────────────────────────────────────────────

describe('buildTimeline', () => {
  it('merges events and adjustments in chronological order', () => {
    const events = [
      { eventType: 'KILL', isOpponentEvent: false, recordedAt: new Date(1000) },
      { eventType: 'KILL', isOpponentEvent: false, recordedAt: new Date(3000) },
    ];
    const adjustments = [
      { homeDelta: 1, awayDelta: 0, createdAt: new Date(2000) },
    ];
    const timeline = buildTimeline(events, adjustments);
    assert.equal(timeline.length, 3);
    assert.equal(timeline[0].kind, 'event');
    assert.equal(timeline[1].kind, 'adjustment');
    assert.equal(timeline[2].kind, 'event');
  });

  it('empty inputs produce an empty timeline and zeroed state', () => {
    const timeline = buildTimeline([], []);
    assert.deepEqual(timeline, []);
    const result = replayTimeline(timeline);
    assert.equal(result.homeScore, 0);
    assert.equal(result.awayScore, 0);
    assert.equal(result.completed, false);
  });
});

// ─── Continuing from a known state (6.8) ──────────────────────────────────────

describe('replayTimeline from a start state', () => {
  const kill = (n: number) => ({ kind: 'event' as const, eventType: 'KILL', isOpponentEvent: false, at: new Date(n) });
  const oppKill = (n: number) => ({ kind: 'event' as const, eventType: 'KILL', isOpponentEvent: true, at: new Date(n) });

  it('adds queued taps to the server score', () => {
    const start = { homeScore: 10, awayScore: 8, homeSetsWon: 1, awaySetsWon: 0, setScores: [{ set: 1, home: 25, away: 20 }] };
    const r = replayTimeline([kill(1), oppKill(2), kill(3)], start);
    assert.deepEqual(r, { homeScore: 12, awayScore: 9, homeSetsWon: 1, awaySetsWon: 0, setScores: [{ set: 1, home: 25, away: 20 }], completed: false, closers: { events: [], adjustments: [] }, sets: { events: new Map(), adjustments: new Map() } });
    assert.equal(start.setScores.length, 1, 'the start state is not mutated');
  });

  it('completes a set provisionally with the current set target', () => {
    // Set 2 at 24-23: one more of ours closes it.
    const r = replayTimeline([kill(1)], { homeScore: 24, awayScore: 23, homeSetsWon: 1, awaySetsWon: 0, setScores: [{ set: 1, home: 25, away: 20 }] });
    assert.equal(r.homeSetsWon, 2);
    assert.deepEqual(r.setScores[1], { set: 2, home: 25, away: 23 });
    assert.equal(r.homeScore, 0);
  });

  it('uses 15 in the fifth set', () => {
    const r = replayTimeline([kill(1)], { homeScore: 14, awayScore: 10, homeSetsWon: 2, awaySetsWon: 2, setScores: [] });
    assert.equal(r.homeSetsWon, 3);
    assert.equal(r.completed, true);
  });

  it('a finished match stays finished', () => {
    const r = replayTimeline([oppKill(1)], { homeScore: 0, awayScore: 0, homeSetsWon: 3, awaySetsWon: 1, setScores: [] });
    assert.equal(r.completed, true);
    assert.equal(r.awayScore, 0);
  });
});

// ─── Set-closing marks (8.0.3) ────────────────────────────────────────────────
// recalculateMatchState writes these back as completedSet, which undo trusts
// under manual override; a mark left on a point that no longer closes a set
// undoes the wrong set.
describe('replayTimeline — closers', () => {
  const t = (s: number) => new Date(s * 1000);
  const kills = (from: number, n: number, prefix: string) =>
    buildTimeline(Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, eventType: 'KILL', isOpponentEvent: false, recordedAt: t(from + i) })), []);

  it('names the event and the adjustment that closed each set', () => {
    // Set 1: 25 kills (e25 closes). Set 2: 24 kills then a +1 adjustment closes it.
    const events = [...kills(0, 25, 'e'), ...kills(100, 24, 'f')];
    const items = [...events, ...buildTimeline([], [{ id: 'a1', homeDelta: 1, awayDelta: 0, createdAt: t(200) }])];
    const r = replayTimeline(items);
    assert.equal(r.homeSetsWon, 2);
    assert.deepEqual(r.closers, { events: ['e25'], adjustments: ['a1'] });
  });

  it('an out-of-order insert moves the closing point', () => {
    const late = { id: 'late', eventType: 'KILL', isOpponentEvent: false, recordedAt: t(0.5) }; // made before e2
    const timeline = buildTimeline([
      ...Array.from({ length: 25 }, (_, i) => ({ id: `e${i + 1}`, eventType: 'KILL', isOpponentEvent: false, recordedAt: t(i) })),
      late,
    ], []);
    const r = replayTimeline(timeline);
    assert.deepEqual(r.closers.events, ['e24'], 'e24 is now the 25th point; e25 opens set 2');
    assert.equal(r.homeScore, 1);
  });

  it('items without ids (queued taps) close sets without being named', () => {
    const r = replayTimeline([evt('KILL')], { homeScore: 24, awayScore: 0, homeSetsWon: 0, awaySetsWon: 0, setScores: [] });
    assert.equal(r.homeSetsWon, 1);
    assert.deepEqual(r.closers, { events: [], adjustments: [] });
  });
});

describe("replayTimeline — each item's set (9.0.5)", () => {
  const at = new Date(0);
  const k = (id: string): ReplayItem => ({ kind: 'event', id, eventType: 'KILL', isOpponentEvent: false, at });
  const a = (id: string, homeDelta: number): ReplayItem => ({ kind: 'adjustment', id, homeDelta, awayDelta: 0, at });

  it('numbers every item by the set it was played in, the closer included', () => {
    const items = [...Array.from({ length: 24 }, (_, i) => k(`e${i}`)), a('adj1', 1), k('next'), a('adj2', 1)];
    const r = replayTimeline(items);
    assert.equal(r.sets.events.get('e0'), 1);
    assert.equal(r.sets.adjustments.get('adj1'), 1, 'the set-closing adjustment belongs to the set it closed');
    assert.equal(r.sets.events.get('next'), 2);
    assert.equal(r.sets.adjustments.get('adj2'), 2);
  });

  it('numbers non-scoring events and zero adjustments too', () => {
    const items = [...Array.from({ length: 25 }, (_, i) => k(`e${i}`)),
      { kind: 'event', id: 'dig', eventType: 'DIG', isOpponentEvent: false, at } as ReplayItem, a('zero', 0)];
    const r = replayTimeline(items);
    assert.equal(r.sets.events.get('dig'), 2);
    assert.equal(r.sets.adjustments.get('zero'), 2);
  });

  it('items after the match ends keep the final set', () => {
    const r = replayTimeline([k('last'), k('after'), a('adjAfter', 1)], { homeScore: 24, awayScore: 0, homeSetsWon: 2, awaySetsWon: 0, setScores: [] });
    assert.equal(r.completed, true);
    assert.equal(r.sets.events.get('last'), 3);
    assert.equal(r.sets.events.get('after'), 3);
    assert.equal(r.sets.adjustments.get('adjAfter'), 3);
  });

  it('items without ids are not numbered', () => {
    const r = replayTimeline([evt('KILL')]);
    assert.equal(r.sets.events.size, 0);
  });
});

// ─── Frontend copies (6.8) ────────────────────────────────────────────────────
// The tracker shows a provisional score from the same rules. The frontend has
// no test runner, so its copies must stay identical to these tested files from
// the marker line down.
describe('frontend copies', () => {
  const from = (file: string, marker: string) => {
    const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    assert.ok(src.includes(marker), `${file} lost its marker`);
    return src.slice(src.indexOf(marker));
  };
  const front = (name: string) => path.join(__dirname, '../../../frontend/src/lib', name);

  it('scoringRules.ts has not drifted', () => {
    const marker = 'export const HOME_POINT_EVENTS';
    assert.equal(from(front('scoringRules.ts'), marker), from(path.join(__dirname, 'scoringRules.ts'), marker));
  });
  it('scoreReplay.ts has not drifted', () => {
    const marker = "import { scoringTeam } from './scoringRules';";
    assert.equal(from(front('scoreReplay.ts'), marker), from(path.join(__dirname, 'scoreReplay.ts'), marker));
  });
});
