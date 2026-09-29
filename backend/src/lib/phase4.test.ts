import assert from 'node:assert/strict';
import { scoringTeam, HOME_POINT_SET, AWAY_POINT_SET } from './scoringRules';
import { validateMatchScore, clampScore } from './scoreValidation';
import { checkMatchIntegrity } from './matchIntegrity';
import { calculateMomentum } from '../services/momentum.service';
import { calculateRotations } from '../services/rotation.service';

// ─── helpers shared across tests ─────────────────────────────────────────────

function hasWonSet(score: number, opponentScore: number, setNumber: number): boolean {
  const target = setNumber >= 5 ? 15 : 25;
  return score >= target && score - opponentScore >= 2;
}

function simulateUndo(homeScore: number, awayScore: number, eventType: string, isOpponentEvent = false) {
  const team = scoringTeam(eventType, isOpponentEvent);
  if (team === 'home') return { homeScore: Math.max(0, homeScore - 1), awayScore };
  if (team === 'away') return { homeScore, awayScore: Math.max(0, awayScore - 1) };
  return { homeScore, awayScore };
}

const now = new Date();
const mkEvent = (type: string, set = 1) => ({ eventType: type, setNumber: set, recordedAt: now });

// ─── Scoring rules ────────────────────────────────────────────────────────────

assert.equal(scoringTeam('KILL'), 'home',        'KILL → home point');
assert.equal(scoringTeam('ACE'), 'home',         'ACE → home point');
assert.equal(scoringTeam('SOLO_BLOCK'), 'home',  'SOLO_BLOCK → home point');
assert.equal(scoringTeam('BLOCK_ASSIST'), 'home','BLOCK_ASSIST → home point');
assert.equal(scoringTeam('ATTACK_ERROR'), 'away', 'ATTACK_ERROR → away point');
assert.equal(scoringTeam('SERVICE_ERROR'), 'away','SERVICE_ERROR → away point');
assert.equal(scoringTeam('DIG_ERROR'), 'away',   'DIG_ERROR → away point');
assert.equal(scoringTeam('SETTING_ERROR'), 'away','SETTING_ERROR → away point');
assert.equal(scoringTeam('BLOCK_ERROR'), 'away', 'BLOCK_ERROR → away point');
assert.equal(scoringTeam('DIG'), null,           'DIG → no point');
assert.equal(scoringTeam('PASS_3'), null,        'PASS_3 → no point');
assert.equal(scoringTeam('ASSIST'), null,        'ASSIST → no point');
assert.ok(HOME_POINT_SET.has('KILL'));
assert.ok(HOME_POINT_SET.has('ACE'));
assert.ok(HOME_POINT_SET.has('SOLO_BLOCK'));
assert.ok(HOME_POINT_SET.has('BLOCK_ASSIST'));
assert.ok(AWAY_POINT_SET.has('ATTACK_ERROR'));
assert.ok(AWAY_POINT_SET.has('SERVICE_ERROR'));
assert.ok(AWAY_POINT_SET.has('DIG_ERROR'));
assert.ok(AWAY_POINT_SET.has('SETTING_ERROR'));
assert.ok(AWAY_POINT_SET.has('BLOCK_ERROR'));
assert.ok(!HOME_POINT_SET.has('DIG'));
assert.ok(!AWAY_POINT_SET.has('DIG'));

console.log('Scoring rules tests passed.');

// ─── Opponent-event scoring (inversion) ──────────────────────────────────────

// An opponent's positive action scores for THEM (away side).
assert.equal(scoringTeam('KILL', true), 'away',         'Opponent KILL → away point');
assert.equal(scoringTeam('ACE', true), 'away',          'Opponent ACE → away point');
assert.equal(scoringTeam('SOLO_BLOCK', true), 'away',   'Opponent SOLO_BLOCK → away point');
assert.equal(scoringTeam('BLOCK_ASSIST', true), 'away', 'Opponent BLOCK_ASSIST → away point');

// An opponent's error scores for US (home side).
assert.equal(scoringTeam('ATTACK_ERROR', true), 'home',  'Opponent ATTACK_ERROR → home point');
assert.equal(scoringTeam('SERVICE_ERROR', true), 'home', 'Opponent SERVICE_ERROR → home point');
assert.equal(scoringTeam('DIG_ERROR', true), 'home',     'Opponent DIG_ERROR → home point');
assert.equal(scoringTeam('SETTING_ERROR', true), 'home', 'Opponent SETTING_ERROR → home point');
assert.equal(scoringTeam('BLOCK_ERROR', true), 'home',   'Opponent BLOCK_ERROR → home point');

// Non-scoring events stay non-scoring regardless of who performed them.
assert.equal(scoringTeam('DIG', true), null,    'Opponent DIG → no point');
assert.equal(scoringTeam('PASS_3', true), null, 'Opponent PASS_3 → no point');

// Explicit false must behave identically to the original single-arg call.
assert.equal(scoringTeam('KILL', false), 'home');
assert.equal(scoringTeam('ATTACK_ERROR', false), 'away');

console.log('Opponent-event scoring tests passed.');

// ─── Score validation ─────────────────────────────────────────────────────────

assert.ok(validateMatchScore({ homeScore: 10, awayScore: 8, homeSetsWon: 1, awaySetsWon: 1 }).valid);
assert.ok(!validateMatchScore({ homeScore: -1, awayScore: 0, homeSetsWon: 0, awaySetsWon: 0 }).valid);
assert.ok(!validateMatchScore({ homeScore: 0, awayScore: -1, homeSetsWon: 0, awaySetsWon: 0 }).valid);
assert.ok(!validateMatchScore({ homeScore: 0, awayScore: 0, homeSetsWon: 4, awaySetsWon: 0 }).valid);
assert.ok(!validateMatchScore({ homeScore: 0, awayScore: 0, homeSetsWon: 0, awaySetsWon: 4 }).valid);
assert.ok(!validateMatchScore({ homeScore: 0, awayScore: 0, homeSetsWon: 3, awaySetsWon: 3 }).valid);

// Completed match with no winner
assert.ok(!validateMatchScore({ homeScore: 0, awayScore: 0, homeSetsWon: 2, awaySetsWon: 2, status: 'COMPLETED' }).valid);
// Completed match with valid winner
assert.ok(validateMatchScore({ homeScore: 0, awayScore: 0, homeSetsWon: 3, awaySetsWon: 1, status: 'COMPLETED' }).valid);

assert.equal(clampScore(5), 5);
assert.equal(clampScore(0), 0);
assert.equal(clampScore(-3), 0);

console.log('Score validation tests passed.');

// ─── Match integrity ──────────────────────────────────────────────────────────

assert.ok(checkMatchIntegrity({
  homeScore: 12, awayScore: 10, homeSetsWon: 1, awaySetsWon: 0, status: 'IN_PROGRESS',
}).ok);

// Negative scores
assert.ok(!checkMatchIntegrity({
  homeScore: -1, awayScore: 0, homeSetsWon: 0, awaySetsWon: 0, status: 'IN_PROGRESS',
}).ok);

// Completed with no winner
const noWinner = checkMatchIntegrity({
  homeScore: 0, awayScore: 0, homeSetsWon: 2, awaySetsWon: 2, status: 'COMPLETED',
});
assert.ok(!noWinner.ok);
assert.ok(noWinner.violations.some((v) => v.includes('COMPLETED')));

// In-progress but has a winner
const staleInProgress = checkMatchIntegrity({
  homeScore: 5, awayScore: 3, homeSetsWon: 3, awaySetsWon: 0, status: 'IN_PROGRESS',
});
assert.ok(!staleInProgress.ok);
assert.ok(staleInProgress.violations.some((v) => v.includes('IN_PROGRESS')));

// setScores count mismatch
const mismatch = checkMatchIntegrity({
  homeScore: 0, awayScore: 0, homeSetsWon: 2, awaySetsWon: 1, status: 'IN_PROGRESS',
  setScores: [{ set: 1, home: 25, away: 20 }],
});
assert.ok(!mismatch.ok);

// Valid completed match
assert.ok(checkMatchIntegrity({
  homeScore: 0, awayScore: 0, homeSetsWon: 3, awaySetsWon: 2, status: 'COMPLETED',
  setScores: [
    { set: 1, home: 25, away: 20 },
    { set: 2, home: 20, away: 25 },
    { set: 3, home: 25, away: 18 },
    { set: 4, home: 22, away: 25 },
    { set: 5, home: 15, away: 12 },
  ],
}).ok);

console.log('Match integrity tests passed.');

// ─── Set completion ────────────────────────────────────────────────────────────

// Standard 25-point sets
assert.ok(hasWonSet(25, 0, 1),   '25-0 = set complete');
assert.ok(hasWonSet(25, 23, 1),  '25-23 = set complete');
assert.ok(!hasWonSet(25, 24, 1), '25-24 = NOT complete (only 1-point lead)');
assert.ok(!hasWonSet(25, 25, 1), '25-25 = NOT complete');
assert.ok(hasWonSet(26, 24, 1),  '26-24 = set complete (deuce)');
assert.ok(!hasWonSet(24, 20, 1), '24-20 = NOT complete (below 25)');
assert.ok(hasWonSet(30, 28, 2),  '30-28 = set complete (extended deuce)');

// Fifth set (first to 15, win by 2)
assert.ok(hasWonSet(15, 0, 5),   '15-0 fifth set = complete');
assert.ok(hasWonSet(15, 13, 5),  '15-13 fifth set = complete');
assert.ok(!hasWonSet(15, 14, 5), '15-14 fifth set = NOT complete');
assert.ok(hasWonSet(16, 14, 5),  '16-14 fifth set = complete');
assert.ok(!hasWonSet(14, 0, 5),  '14-0 fifth set = NOT complete (below 15)');

console.log('Set completion logic tests passed.');

// ─── Match completion ─────────────────────────────────────────────────────────

function isMatchComplete(h: number, a: number) { return h >= 3 || a >= 3; }

assert.ok(isMatchComplete(3, 0),  '3-0 = complete');
assert.ok(isMatchComplete(3, 2),  '3-2 = complete');
assert.ok(isMatchComplete(0, 3),  '0-3 = complete');
assert.ok(isMatchComplete(2, 3),  '2-3 = complete');
assert.ok(!isMatchComplete(2, 2), '2-2 = not complete');
assert.ok(!isMatchComplete(1, 2), '1-2 = not complete');

console.log('Match completion tests passed.');

// ─── Undo / delete score reversal ────────────────────────────────────────────

// Every home-scoring event type
for (const type of ['KILL', 'ACE', 'SOLO_BLOCK', 'BLOCK_ASSIST']) {
  const s = simulateUndo(10, 5, type);
  assert.equal(s.homeScore, 9, `Undo ${type} must decrement homeScore`);
  assert.equal(s.awayScore, 5, `Undo ${type} must not change awayScore`);
}

// Every away-scoring event type
for (const type of ['ATTACK_ERROR', 'SERVICE_ERROR', 'DIG_ERROR', 'SETTING_ERROR', 'BLOCK_ERROR']) {
  const s = simulateUndo(10, 5, type);
  assert.equal(s.homeScore, 10, `Undo ${type} must not change homeScore`);
  assert.equal(s.awayScore, 4, `Undo ${type} must decrement awayScore`);
}

// Non-scoring events leave scores unchanged
for (const type of ['DIG', 'PASS_3', 'ASSIST', 'SERVE_IN']) {
  const s = simulateUndo(10, 5, type);
  assert.equal(s.homeScore, 10);
  assert.equal(s.awayScore, 5);
}

// Score clamped at 0
assert.equal(simulateUndo(0, 0, 'KILL').homeScore, 0, 'homeScore cannot go below 0 on undo');
assert.equal(simulateUndo(0, 0, 'ATTACK_ERROR').awayScore, 0, 'awayScore cannot go below 0 on undo');

// Undo of opponent events reverses the INVERTED score.
// Opponent KILL scored an away point, so undoing it decrements awayScore.
const oppKillUndo = simulateUndo(10, 5, 'KILL', true);
assert.equal(oppKillUndo.homeScore, 10, 'Undo opponent KILL must not change homeScore');
assert.equal(oppKillUndo.awayScore, 4,  'Undo opponent KILL must decrement awayScore');

// Opponent SERVICE_ERROR scored a home point, so undoing it decrements homeScore.
const oppErrUndo = simulateUndo(10, 5, 'SERVICE_ERROR', true);
assert.equal(oppErrUndo.homeScore, 9, 'Undo opponent SERVICE_ERROR must decrement homeScore');
assert.equal(oppErrUndo.awayScore, 5, 'Undo opponent SERVICE_ERROR must not change awayScore');

console.log('Undo score reversal tests passed.');

// ─── recalculateMatchState simulation (pure replay, no DB) ───────────────────

interface SimEvent { eventType: string; isOpponentEvent?: boolean }

function replayMatchState(events: SimEvent[]) {
  let homeScore = 0, awayScore = 0, homeSetsWon = 0, awaySetsWon = 0;
  const setScores: { set: number; home: number; away: number }[] = [];
  let completed = false;

  for (const e of events) {
    const team = scoringTeam(e.eventType, e.isOpponentEvent ?? false);
    if (team === 'home') homeScore++;
    else if (team === 'away') awayScore++;
    else continue;

    const currentSet = homeSetsWon + awaySetsWon + 1;
    if (hasWonSet(homeScore, awayScore, currentSet)) {
      setScores.push({ set: currentSet, home: homeScore, away: awayScore });
      homeSetsWon++; homeScore = 0; awayScore = 0;
    } else if (hasWonSet(awayScore, homeScore, currentSet)) {
      setScores.push({ set: currentSet, home: homeScore, away: awayScore });
      awaySetsWon++; homeScore = 0; awayScore = 0;
    }
    if (homeSetsWon >= 3 || awaySetsWon >= 3) { completed = true; break; }
  }

  return { homeScore, awayScore, homeSetsWon, awaySetsWon, setScores, completed };
}

// Scenario A: 25-23 set, undo final kill → 24-23, set no longer complete
// Away points come first so the last event is the 25th KILL (the winning point)
const setEvents = [
  ...Array(23).fill({ eventType: 'ATTACK_ERROR' }),
  ...Array(25).fill({ eventType: 'KILL' }),
];
const withSet = replayMatchState(setEvents);
assert.equal(withSet.homeSetsWon, 1, 'Set should be recorded after 25-23');
assert.equal(withSet.homeScore, 0, 'homeScore resets to 0 after set win');

const undoneEvents = setEvents.slice(0, -1); // remove last KILL → 24-23
const withoutFinalKill = replayMatchState(undoneEvents);
assert.equal(withoutFinalKill.homeSetsWon, 0, 'Set no longer complete after undo');
assert.equal(withoutFinalKill.homeScore, 24, 'homeScore should be 24 after undo');
assert.equal(withoutFinalKill.awayScore, 23);

// Scenario B: Match completed 3-1, undo final winning point → IN_PROGRESS
// Away points first so the last event in each set is always the winning home point.
// This ensures slice(0, -1) removes the match-winning point for undo tests.
function buildMatchEvents(sets: { home: number; away: number }[]): SimEvent[] {
  const events: SimEvent[] = [];
  for (const s of sets) {
    for (let i = 0; i < s.away; i++) events.push({ eventType: 'ATTACK_ERROR' });
    for (let i = 0; i < s.home; i++) events.push({ eventType: 'KILL' });
  }
  return events;
}

// 3 sets won home: 25-20, 25-18, 25-22
const matchWinEvents = buildMatchEvents([
  { home: 25, away: 20 },
  { home: 25, away: 18 },
  { home: 25, away: 22 },
]);
const matchComplete = replayMatchState(matchWinEvents);
assert.equal(matchComplete.homeSetsWon, 3, 'Match should be complete with 3 sets won');
assert.ok(matchComplete.completed, 'completed flag should be true');

// Undo final point
const undoneMatch = replayMatchState(matchWinEvents.slice(0, -1));
assert.equal(undoneMatch.homeSetsWon, 2, 'After undo, only 2 sets won');
assert.ok(!undoneMatch.completed, 'Match should no longer be completed');

// 5-set match replay
const fiveSetEvents = buildMatchEvents([
  { home: 25, away: 20 },
  { home: 20, away: 25 },
  { home: 25, away: 18 },
  { home: 22, away: 25 },
  { home: 15, away: 13 },
]);
const fiveSet = replayMatchState(fiveSetEvents);
assert.equal(fiveSet.homeSetsWon, 3);
assert.equal(fiveSet.awaySetsWon, 2);
assert.equal(fiveSet.setScores.length, 5);
assert.ok(fiveSet.completed);

// Replay including opponent events: an opponent kill must count for the AWAY side,
// and an opponent error for the HOME side — then undo (slice) restores the prior state.
const oppReplayEvents: SimEvent[] = [
  { eventType: 'KILL' },                            // home 1-0
  { eventType: 'KILL', isOpponentEvent: true },     // away scores: 1-1
  { eventType: 'SERVICE_ERROR', isOpponentEvent: true }, // home scores: 2-1
];
const oppReplay = replayMatchState(oppReplayEvents);
assert.equal(oppReplay.homeScore, 2, 'Own kill + opponent error → home 2');
assert.equal(oppReplay.awayScore, 1, 'Opponent kill → away 1');

const oppReplayUndone = replayMatchState(oppReplayEvents.slice(0, -1));
assert.equal(oppReplayUndone.homeScore, 1, 'Undo opponent error → home back to 1');
assert.equal(oppReplayUndone.awayScore, 1, 'awayScore unchanged by that undo');

console.log('Match state recalculation tests passed.');

// ─── Momentum analytics ───────────────────────────────────────────────────────

// Empty
const emptyMomentum = calculateMomentum([]);
assert.equal(emptyMomentum.stats.totalPoints, 0);
assert.equal(emptyMomentum.timeline.length, 0);
assert.equal(emptyMomentum.significantRuns.length, 0);

// Longest home run
const homeRun5 = Array(5).fill(mkEvent('KILL'));
const hr = calculateMomentum(homeRun5);
assert.equal(hr.stats.longestHomeRun, 5,  'Longest home run should be 5');
assert.equal(hr.stats.longestAwayRun, 0);
assert.equal(hr.stats.totalPoints, 5);
assert.equal(hr.timeline[4].lead, 5,      'Lead should be +5 after 5 home points');

// Longest away run
const awayRun4 = Array(4).fill(mkEvent('ATTACK_ERROR'));
const ar = calculateMomentum(awayRun4);
assert.equal(ar.stats.longestAwayRun, 4,  'Longest away run should be 4');
assert.equal(ar.timeline[3].lead, -4,     'Lead should be -4 after 4 away points');

// Lead changes: the lead passing from one side to the other. A tie isn't one
// (the old count added one every time the score went level).
const seeSaw = ['KILL', 'ATTACK_ERROR', 'ATTACK_ERROR', 'KILL', 'KILL'].map((t) => mkEvent(t)); // leads 1, 0, -1, 0, 1
const ss = calculateMomentum(seeSaw);
assert.equal(ss.stats.leadChanges, 2, 'us -> them -> us');
const levelOnly = calculateMomentum(['KILL', 'ATTACK_ERROR', 'KILL', 'ATTACK_ERROR'].map((t) => mkEvent(t)));
assert.equal(levelOnly.stats.leadChanges, 0, 'going level and back is not a lead change');

// Largest lead
const leads = [
  ...Array(10).fill(mkEvent('KILL')),
  ...Array(4).fill(mkEvent('ATTACK_ERROR')),
];
const ld = calculateMomentum(leads);
assert.equal(ld.stats.largestHomeLead, 10, 'Largest home lead should be 10');

// Significant run threshold (3+)
const run3 = [...Array(3).fill(mkEvent('ACE')), mkEvent('ATTACK_ERROR')];
const sig = calculateMomentum(run3);
assert.ok(sig.significantRuns.length >= 1, 'Run of 3 should be significant');
assert.ok(sig.significantRuns[0].length >= 3);

// Non-scoring events must not appear in timeline
const mixed = [mkEvent('DIG'), mkEvent('KILL'), mkEvent('PASS_3')];
const mx = calculateMomentum(mixed);
assert.equal(mx.stats.totalPoints, 1, 'Only 1 scoring event in mixed set');

// 7.5: opponent events score with the inversion (an opponent kill is their point).
const t0 = new Date('2026-09-29T10:00:00Z').getTime();
const at = (s: number) => new Date(t0 + s * 1000);
const ev = (eventType: string, set: number, sec: number, isOpponentEvent = false) =>
  ({ eventType, setNumber: set, recordedAt: at(sec), isOpponentEvent });
const opp = calculateMomentum([ev('KILL', 1, 1, true), ev('SERVICE_ERROR', 1, 2, true)]);
assert.deepEqual(opp.timeline.map((p) => p.scorer), ['away', 'home'], 'opponent kill -> them; opponent error -> us');

// Score, lead and runs reset each set; runs never cross a set.
const twoSets = calculateMomentum([
  ev('KILL', 1, 1), ev('KILL', 1, 2), ev('KILL', 1, 3), // set 1: us 3-0
  ev('KILL', 2, 10), ev('KILL', 2, 11),                   // set 2 opens with 2 of ours (not a run of 5)
  ev('ATTACK_ERROR', 2, 12), ev('ATTACK_ERROR', 2, 13), ev('ATTACK_ERROR', 2, 14), ev('ATTACK_ERROR', 2, 15),
]);
const s2first = twoSets.timeline.find((p) => p.setNumber === 2)!;
assert.deepEqual([s2first.homeScore, s2first.awayScore, s2first.runLength, s2first.pointInSet], [1, 0, 1, 1], 'set 2 starts from 0-0');
assert.equal(twoSets.stats.longestHomeRun, 3, 'a run across a set boundary counts as two runs');
assert.equal(twoSets.stats.longestAwayRun, 4);
assert.equal(twoSets.stats.largestHomeLead, 3, 'max over the sets');
assert.equal(twoSets.stats.largestAwayLead, 2, 'set 2: 2-4');
assert.equal(twoSets.stats.leadChanges, 1, 'summed over the sets: set 2 went 2-0 to 2-3');
assert.ok(twoSets.significantRuns.every((r) => r.length <= 4));
assert.deepEqual(twoSets.significantRuns.map((r) => [r.setNumber, r.team, r.length]), [[1, 'home', 3], [2, 'away', 4]]);
assert.deepEqual(twoSets.sets.map((x) => [x.setNumber, x.homeScore, x.awayScore, x.totalPoints]), [[1, 3, 0, 3], [2, 2, 4, 6]]);

// Sorted by time inside the function: arrival order doesn't matter.
const shuffled = calculateMomentum([ev('ATTACK_ERROR', 1, 3), ev('KILL', 1, 1), ev('KILL', 1, 2)]);
assert.deepEqual(shuffled.timeline.map((p) => p.scorer), ['home', 'home', 'away']);

console.log('Momentum analytics tests passed.');

// ─── Rotation analytics ───────────────────────────────────────────────────────

// Empty — 6 slots, all zeroed, no insights
const emptyRot = calculateRotations([]);
assert.equal(emptyRot.rotations.length, 6);
assert.equal(emptyRot.insights.best, null);
assert.equal(emptyRot.insights.worst, null);

// All home points in rotation 3
const rot3 = Array(8).fill({ eventType: 'KILL', rotationNumber: 3 });
const r3result = calculateRotations(rot3);
const r3 = r3result.rotations.find((r) => r.rotation === 3)!;
assert.equal(r3.won, 8);
assert.equal(r3.lost, 0);
assert.equal(r3.net, 8);
assert.equal(r3.pointWinPct, 100, 'Point win % is 100 for a rotation with only wins');

// Best and worst rotation
const mixed2 = [
  ...Array(5).fill({ eventType: 'KILL', rotationNumber: 1 }),
  ...Array(2).fill({ eventType: 'ATTACK_ERROR', rotationNumber: 1 }),
  ...Array(1).fill({ eventType: 'KILL', rotationNumber: 2 }),
  ...Array(4).fill({ eventType: 'ATTACK_ERROR', rotationNumber: 2 }),
];
const mr = calculateRotations(mixed2);
assert.equal(mr.insights.best!.rotation, 1,  'Rotation 1 has better net (+3)');
assert.equal(mr.insights.worst!.rotation, 2, 'Rotation 2 has worse net (-3)');

// Point win % (what the old "side-out efficiency" really measured)
const eff = [
  ...Array(3).fill({ eventType: 'KILL', rotationNumber: 5 }),
  { eventType: 'ATTACK_ERROR', rotationNumber: 5 },
];
const effR = calculateRotations(eff);
const r5 = effR.rotations.find((r) => r.rotation === 5)!;
assert.equal(r5.pointWinPct, 75, 'Point win %: 3/4 = 75%');

// highestPointWin / lowestPointWin (renamed from highestSideOut / lowestSideOut)
assert.ok(effR.insights.highestPointWin !== null);
assert.ok(effR.insights.lowestPointWin !== null);

// 7.4: opponent events score with the inversion.
const oppRot = calculateRotations([
  { eventType: 'KILL', rotationNumber: 2, isOpponentEvent: true },          // their kill: we lost it
  { eventType: 'SERVICE_ERROR', rotationNumber: 2, isOpponentEvent: true }, // their error: we won it
  { eventType: 'KILL', rotationNumber: 2 },
]);
const r2 = oppRot.rotations.find((r) => r.rotation === 2)!;
assert.deepEqual([r2.won, r2.lost, r2.net, r2.pointWinPct], [2, 1, 1, 67]);

// Side-out and break-point per rotation, from the serving side.
const served = calculateRotations([
  { eventType: 'KILL', rotationNumber: 1, servingSide: 'THEM' },
  { eventType: 'ATTACK_ERROR', rotationNumber: 1, servingSide: 'THEM' },
  { eventType: 'ACE', rotationNumber: 1, servingSide: 'US' },
  { eventType: 'KILL', rotationNumber: 1 },
]);
const s1 = served.rotations.find((r) => r.rotation === 1)!;
assert.deepEqual([s1.sideOutPct, s1.breakPointPct, s1.receiveRallies, s1.serveRallies], [50, 100, 2, 1]);

// Null rotation numbers must be ignored
const nullRot = [
  { eventType: 'KILL', rotationNumber: null },
  { eventType: 'KILL', rotationNumber: 4 },
];
const nr = calculateRotations(nullRot);
assert.equal(nr.rotations.find((r) => r.rotation === 4)!.won, 1);
assert.ok(nr.rotations.every((r) => r.rotation >= 1 && r.rotation <= 6));

// Out-of-range (7) must be ignored
const oor = calculateRotations([{ eventType: 'KILL', rotationNumber: 7 }]);
assert.ok(oor.rotations.every((r) => r.total === 0));

console.log('Rotation analytics tests passed.');
