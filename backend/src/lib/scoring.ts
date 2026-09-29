import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { completeSet, currentSetNumber } from './setOperations';
import type { MatchScoreState, SetScoreEntry } from './setOperations';

// Volleyball set win rules:
// Sets 1–4: first to 25, win by 2
// Set 5 (deciding): first to 15, win by 2
// Match: best of 5 (first to 3 sets)
function setWinTarget(setNumber: number): number {
  return setNumber >= 5 ? 15 : 25;
}

export function hasWonSet(score: number, opponentScore: number, setNumber: number): boolean {
  const target = setWinTarget(setNumber);
  return score >= target && score - opponentScore >= 2;
}

/**
 * Reads a match into the plain state shape the pure set helpers operate on.
 * Inside a transaction pass its client: the module-level one is a separate
 * connection and wouldn't see the transaction's own uncommitted writes.
 */
export async function loadScoreState(matchId: string, db: Prisma.TransactionClient = prisma): Promise<MatchScoreState | null> {
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      homeScore: true,
      awayScore: true,
      homeSetsWon: true,
      awaySetsWon: true,
      setScores: true,
      status: true,
    },
  });
  if (!match) return null;

  return {
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeSetsWon: match.homeSetsWon,
    awaySetsWon: match.awaySetsWon,
    setScores: Array.isArray(match.setScores) ? (match.setScores as unknown as SetScoreEntry[]) : [],
    status: match.status,
  };
}

/**
 * Auto-completes the current set the moment a side passes the threshold with a
 * 2-point lead. This function only decides *whether* the threshold has been
 * met; the completion effects themselves live in setOperations.completeSet.
 *
 * This is the only set-completion path in use. The manual End Set override that
 * also called completeSet is currently disabled (see controllers/matches.ts) —
 * that does not affect this path.
 *
 * Returns true when it actually completed a set. Callers run this immediately
 * after their own score-affecting write, so a true return identifies THEIR
 * write as the one that closed the set — which they record on the row
 * (`completedSet`) because it can't be worked out afterwards: completion zeroes
 * the running score that undo would otherwise reverse against. See lib/undo.ts.
 */
export async function checkSetCompletion(matchId: string, db: Prisma.TransactionClient = prisma): Promise<boolean> {
  const state = await loadScoreState(matchId, db);
  if (!state || state.status === 'COMPLETED') return false;

  const setNumber = currentSetNumber(state);
  const homeWinsSet = hasWonSet(state.homeScore, state.awayScore, setNumber);
  const awayWinsSet = hasWonSet(state.awayScore, state.homeScore, setNumber);

  if (!homeWinsSet && !awayWinsSet) return false;

  const next = completeSet(state, homeWinsSet ? 'home' : 'away');

  await db.match.update({
    where: { id: matchId },
    data: {
      homeScore: next.homeScore,
      awayScore: next.awayScore,
      homeSetsWon: next.homeSetsWon,
      awaySetsWon: next.awaySetsWon,
      setScores: next.setScores,
      ...(next.status === 'COMPLETED' ? { status: 'COMPLETED' as const } : {}),
    },
  });

  return true;
}
