import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  completeSet,
  resetMatchScore,
  reverseEventScore,
  leadingSide,
  currentSetNumber,
  parseSetScoresEdit,
} from './setOperations';
import type { MatchScoreState } from './setOperations';
import { checkMatchIntegrity } from './matchIntegrity';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function state(overrides: Partial<MatchScoreState> = {}): MatchScoreState {
  return {
    homeScore: 0,
    awayScore: 0,
    homeSetsWon: 0,
    awaySetsWon: 0,
    setScores: [],
    status: 'IN_PROGRESS',
    ...overrides,
  };
}

/** Every operation must leave the match in a state matchIntegrity accepts. */
function assertIntegrity(s: MatchScoreState, label: string) {
  const result = checkMatchIntegrity({
    homeScore: s.homeScore,
    awayScore: s.awayScore,
    homeSetsWon: s.homeSetsWon,
    awaySetsWon: s.awaySetsWon,
    status: s.status,
    setScores: s.setScores,
  });
  assert.ok(result.ok, `${label} violated match integrity: ${result.violations.join('; ')}`);
}

// ─── currentSetNumber / leadingSide ───────────────────────────────────────────

describe('currentSetNumber', () => {
  it('is 1 on a fresh match and advances with sets won by either side', () => {
    assert.equal(currentSetNumber(state()), 1);
    assert.equal(currentSetNumber(state({ homeSetsWon: 2, awaySetsWon: 1 })), 4);
  });
});

describe('leadingSide', () => {
  it('names the leader and returns null on a tie', () => {
    assert.equal(leadingSide({ homeScore: 18, awayScore: 12 }), 'home');
    assert.equal(leadingSide({ homeScore: 12, awayScore: 18 }), 'away');
    assert.equal(leadingSide({ homeScore: 0, awayScore: 0 }), null);
    assert.equal(leadingSide({ homeScore: 20, awayScore: 20 }), null);
  });
});

// ─── completeSet — shared by the automatic and manual paths ───────────────────

describe('completeSet', () => {
  it('banks the running score, awards the set, and zeroes the score', () => {
    const next = completeSet(state({ homeScore: 25, awayScore: 22 }), 'home');
    assert.equal(next.homeSetsWon, 1);
    assert.equal(next.awaySetsWon, 0);
    assert.equal(next.homeScore, 0, 'running score resets for the next set');
    assert.equal(next.awayScore, 0);
    assert.deepEqual(next.setScores, [{ set: 1, home: 25, away: 22 }]);
    assert.equal(next.status, 'IN_PROGRESS');
    assertIntegrity(next, 'completeSet');
  });

  it('records a below-threshold score verbatim (the manual override case)', () => {
    // A forfeit/abandoned set ends 18-12; the real score is what gets recorded.
    const next = completeSet(state({ homeScore: 18, awayScore: 12 }), 'home');
    assert.deepEqual(next.setScores, [{ set: 1, home: 18, away: 12 }]);
    assert.equal(next.homeSetsWon, 1);
    assertIntegrity(next, 'completeSet below threshold');
  });

  it('appends to existing history under the correct set number', () => {
    const next = completeSet(
      state({
        homeScore: 25, awayScore: 18,
        homeSetsWon: 1, awaySetsWon: 1,
        setScores: [{ set: 1, home: 25, away: 20 }, { set: 2, home: 22, away: 25 }],
      }),
      'home',
    );
    assert.equal(next.setScores.length, 3);
    assert.deepEqual(next.setScores[2], { set: 3, home: 25, away: 18 });
    assert.equal(next.homeSetsWon, 2);
    assertIntegrity(next, 'completeSet append');
  });

  it('completes the match when a side reaches 3 sets', () => {
    const next = completeSet(
      state({
        homeScore: 25, awayScore: 20,
        homeSetsWon: 2, awaySetsWon: 1,
        setScores: [
          { set: 1, home: 25, away: 20 },
          { set: 2, home: 20, away: 25 },
          { set: 3, home: 25, away: 18 },
        ],
        status: 'IN_PROGRESS',
      }),
      'home',
    );
    assert.equal(next.homeSetsWon, 3);
    assert.equal(next.status, 'COMPLETED', 'third set win completes the match');
    assertIntegrity(next, 'completeSet match win');
  });

  it('does not complete the match below 3 sets', () => {
    const next = completeSet(state({ homeScore: 25, awayScore: 20, homeSetsWon: 1, awaySetsWon: 1, setScores: [{ set: 1, home: 25, away: 1 }, { set: 2, home: 1, away: 25 }] }), 'home');
    assert.equal(next.homeSetsWon, 2);
    assert.equal(next.status, 'IN_PROGRESS');
  });

  it('awards to away correctly', () => {
    const next = completeSet(state({ homeScore: 23, awayScore: 25 }), 'away');
    assert.equal(next.awaySetsWon, 1);
    assert.equal(next.homeSetsWon, 0);
    assert.deepEqual(next.setScores, [{ set: 1, home: 23, away: 25 }]);
  });

  it('replaces rather than duplicates an entry for the current set', () => {
    // A stale entry for the in-progress set must not survive alongside the new one.
    const next = completeSet(
      state({ homeScore: 25, awayScore: 20, setScores: [{ set: 1, home: 9, away: 9 }] }),
      'home',
    );
    assert.equal(next.setScores.length, 1);
    assert.deepEqual(next.setScores, [{ set: 1, home: 25, away: 20 }]);
  });
});

// ─── resetMatchScore ──────────────────────────────────────────────────────────

describe('resetMatchScore', () => {
  it('zeroes a match with several sets already recorded', () => {
    const next = resetMatchScore(state({
      homeScore: 12, awayScore: 9,
      homeSetsWon: 2, awaySetsWon: 1,
      setScores: [
        { set: 1, home: 25, away: 20 },
        { set: 2, home: 20, away: 25 },
        { set: 3, home: 25, away: 18 },
      ],
    }));
    assert.equal(next.homeScore, 0);
    assert.equal(next.awayScore, 0);
    assert.equal(next.homeSetsWon, 0);
    assert.equal(next.awaySetsWon, 0);
    assert.deepEqual(next.setScores, [], 'history cleared entirely');
    assertIntegrity(next, 'resetMatchScore');
  });

  it('reopens a completed match', () => {
    const next = resetMatchScore(state({
      homeSetsWon: 3, awaySetsWon: 0, status: 'COMPLETED',
      setScores: [
        { set: 1, home: 25, away: 20 },
        { set: 2, home: 25, away: 21 },
        { set: 3, home: 25, away: 18 },
      ],
    }));
    assert.equal(next.status, 'IN_PROGRESS');
    assertIntegrity(next, 'resetMatchScore reopen');
  });

  it('leaves a non-completed status untouched', () => {
    assert.equal(resetMatchScore(state({ status: 'SCHEDULED' })).status, 'SCHEDULED');
    assert.equal(resetMatchScore(state({ status: 'IN_PROGRESS' })).status, 'IN_PROGRESS');
  });
});

// ─── reverseEventScore — the manual-override undo path ────────────────────────

describe('reverseEventScore', () => {
  it('decrements home for home-scoring events', () => {
    for (const type of ['KILL', 'ACE', 'SOLO_BLOCK', 'BLOCK_ASSIST']) {
      const next = reverseEventScore(state({ homeScore: 10, awayScore: 5 }), type, false);
      assert.equal(next.homeScore, 9, `${type} must decrement home`);
      assert.equal(next.awayScore, 5);
    }
  });

  it('decrements away for away-scoring events', () => {
    for (const type of ['ATTACK_ERROR', 'SERVICE_ERROR', 'DIG_ERROR', 'SETTING_ERROR', 'BLOCK_ERROR']) {
      const next = reverseEventScore(state({ homeScore: 10, awayScore: 5 }), type, false);
      assert.equal(next.homeScore, 10);
      assert.equal(next.awayScore, 4, `${type} must decrement away`);
    }
  });

  it('leaves the score alone for non-scoring events', () => {
    for (const type of ['DIG', 'PASS_3', 'ASSIST', 'SERVE_IN']) {
      const next = reverseEventScore(state({ homeScore: 10, awayScore: 5 }), type, false);
      assert.equal(next.homeScore, 10);
      assert.equal(next.awayScore, 5);
    }
  });

  it('inverts opponent events', () => {
    const oppKill = reverseEventScore(state({ homeScore: 10, awayScore: 5 }), 'KILL', true);
    assert.equal(oppKill.awayScore, 4, 'opponent kill scored away, so undo decrements away');
    assert.equal(oppKill.homeScore, 10);

    const oppErr = reverseEventScore(state({ homeScore: 10, awayScore: 5 }), 'SERVICE_ERROR', true);
    assert.equal(oppErr.homeScore, 9, 'opponent error scored home, so undo decrements home');
    assert.equal(oppErr.awayScore, 5);
  });

  it('clamps at zero and never touches set state', () => {
    const next = reverseEventScore(
      state({ homeScore: 0, awayScore: 0, homeSetsWon: 2, awaySetsWon: 1, setScores: [{ set: 1, home: 25, away: 1 }] }),
      'KILL',
      false,
    );
    assert.equal(next.homeScore, 0);
    assert.equal(next.homeSetsWon, 2, 'set state is preserved under manual override');
    assert.equal(next.awaySetsWon, 1);
    assert.deepEqual(next.setScores, [{ set: 1, home: 25, away: 1 }]);
  });
});

describe('parseSetScoresEdit (9.0.5)', () => {
  const s = (set: number, home: number, away: number) => ({ set, home, away });

  it('derives sets won from the higher score of each set, forfeits included', () => {
    assert.deepEqual(parseSetScoresEdit([s(1, 25, 20), s(2, 18, 12), s(3, 10, 15)]), {
      setScores: [s(1, 25, 20), s(2, 18, 12), s(3, 10, 15)], homeSetsWon: 2, awaySetsWon: 1,
    });
    assert.deepEqual(parseSetScoresEdit([]), { setScores: [], homeSetsWon: 0, awaySetsWon: 0 });
  });

  it('refuses what a match could not have', () => {
    const refused = (raw: unknown) => assert.ok('error' in parseSetScoresEdit(raw), JSON.stringify(raw));
    refused(null);
    refused('25-20');
    refused([s(1, 25, 25)]); // a tie
    refused([s(1, 25.5, 20)]);
    refused([s(1, -1, 20)]);
    refused([s(1, 1000, 20)]);
    refused([s(2, 25, 20)]); // numbered from 1
    refused([s(1, 25, 20), s(1, 25, 20)]);
    refused(Array.from({ length: 6 }, (_, i) => s(i + 1, 25, 20)));
    refused([s(1, 25, 20), s(2, 25, 20), s(3, 25, 20), s(4, 25, 20)]); // a set after the match was won
    refused([{ set: 1, home: '25', away: 20 }]);
  });
});
