// Pure set-boundary operations, shared by the automatic scoring path
// (lib/scoring.ts), the manual override endpoints (controllers/matches.ts),
// and their tests.
//
// Kept free of Prisma — like lib/scoreReplay.ts — so `npm test` can exercise
// every rule without a database. The controllers are thin: read the row, apply
// one of these functions, write the result back.

import { scoringTeam } from './scoringRules';

// A type alias rather than an interface on purpose: Prisma's Json input types
// require an implicit index signature, which interfaces don't get. This lets
// setScores be written straight to the Json column without a cast.
export type SetScoreEntry = {
  set: number;
  home: number;
  away: number;
};

export interface MatchScoreState {
  homeScore: number;
  awayScore: number;
  homeSetsWon: number;
  awaySetsWon: number;
  setScores: SetScoreEntry[];
  status: string;
}

export type Side = 'home' | 'away';

/** Best-of-5: the first side to take 3 sets wins the match. */
export const SETS_TO_WIN_MATCH = 3;

/** The set currently being played (1-based). */
export function currentSetNumber(state: Pick<MatchScoreState, 'homeSetsWon' | 'awaySetsWon'>): number {
  return state.homeSetsWon + state.awaySetsWon + 1;
}

/**
 * Whichever side currently leads the running score, or null if it's tied.
 * Also picks each set's winner in a setScores edit (parseSetScoresEdit).
 */
export function leadingSide(state: Pick<MatchScoreState, 'homeScore' | 'awayScore'>): Side | null {
  if (state.homeScore > state.awayScore) return 'home';
  if (state.awayScore > state.homeScore) return 'away';
  return null;
}

/**
 * The completion effects for a set won by `winner`: bank the running score into
 * setScores, award the set, zero the running score for the next one, and
 * complete the match once a side reaches 3.
 *
 * Both the automatic threshold path and the manual End Set override call this,
 * so the two can never drift apart. It deliberately does NOT decide *whether*
 * the set is over — callers do that (threshold vs. coach's judgement).
 */
export function completeSet(state: MatchScoreState, winner: Side): MatchScoreState {
  const setNumber = currentSetNumber(state);

  const setScores = [
    ...state.setScores.filter((s) => s.set !== setNumber),
    { set: setNumber, home: state.homeScore, away: state.awayScore },
  ].sort((a, b) => a.set - b.set);

  const homeSetsWon = state.homeSetsWon + (winner === 'home' ? 1 : 0);
  const awaySetsWon = state.awaySetsWon + (winner === 'away' ? 1 : 0);
  const matchWon = homeSetsWon >= SETS_TO_WIN_MATCH || awaySetsWon >= SETS_TO_WIN_MATCH;

  return {
    homeScore: 0,
    awayScore: 0,
    homeSetsWon,
    awaySetsWon,
    setScores,
    status: matchWon ? 'COMPLETED' : state.status,
  };
}

/** Zero the entire match: no sets won, no history, no running score. */
export function resetMatchScore(state: MatchScoreState): MatchScoreState {
  return {
    homeScore: 0,
    awayScore: 0,
    homeSetsWon: 0,
    awaySetsWon: 0,
    setScores: [],
    status: state.status === 'COMPLETED' ? 'IN_PROGRESS' : state.status,
  };
}

/**
 * Reverse a single event's contribution to the running score, clamped at zero.
 *
 * This is the fallback for removing an event from a match under manual
 * override, where replaying the timeline would discard the override. Non-scoring
 * events (digs, passes, assists) leave the score untouched.
 */
export function reverseEventScore(
  state: MatchScoreState,
  eventType: string,
  isOpponentEvent: boolean,
): MatchScoreState {
  const team = scoringTeam(eventType, isOpponentEvent);
  if (team === 'home') return { ...state, homeScore: Math.max(0, state.homeScore - 1) };
  if (team === 'away') return { ...state, awayScore: Math.max(0, state.awayScore - 1) };
  return state;
}

/**
 * A coach's edit of the finished-set scores (9.0.5, PATCH /matches/:id and its
 * approval). Up to 5 sets numbered from 1, whole scores 0–999, no ties, and no
 * set after one side has 3. Each set goes to the higher score: not the 25/15
 * win rule, so a forfeit such as 18–12 still counts.
 */
export function parseSetScoresEdit(
  raw: unknown,
): { setScores: SetScoreEntry[]; homeSetsWon: number; awaySetsWon: number } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'setScores must be a list of sets.' };
  if (raw.length > 5) return { error: 'A match has at most 5 sets.' };
  const won = { home: 0, away: 0 };
  const setScores: SetScoreEntry[] = [];
  for (const [i, entry] of raw.entries()) {
    const { set, home, away } = (entry ?? {}) as Record<string, unknown>;
    const whole = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 999;
    if (set !== i + 1 || !whole(home) || !whole(away)) {
      return { error: `Set ${i + 1} needs its number and two whole scores from 0 to 999.` };
    }
    if (won.home === SETS_TO_WIN_MATCH || won.away === SETS_TO_WIN_MATCH) {
      return { error: `The match was already won before set ${i + 1}.` };
    }
    const winner = leadingSide({ homeScore: home, awayScore: away });
    if (!winner) return { error: `Set ${i + 1} can't be a tie.` };
    won[winner]++;
    setScores.push({ set: i + 1, home, away });
  }
  return { setScores, homeSetsWon: won.home, awaySetsWon: won.away };
}

/**
 * The match status after a set-score edit, so status and sets won can't
 * disagree: 3 sets completes the match, fewer reopens a completed one, and
 * any other status (scheduled, cancelled) is left as the coach set it.
 */
export function statusAfterSetEdit(current: string, won: { homeSetsWon: number; awaySetsWon: number }): string {
  if (won.homeSetsWon >= SETS_TO_WIN_MATCH || won.awaySetsWon >= SETS_TO_WIN_MATCH) return 'COMPLETED';
  return current === 'COMPLETED' ? 'IN_PROGRESS' : current;
}
