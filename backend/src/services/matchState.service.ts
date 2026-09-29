import { MatchStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { buildTimeline, replayTimeline } from '../lib/scoreReplay';
import { reverseEventScore } from '../lib/setOperations';
import type { MatchScoreState, SetScoreEntry } from '../lib/setOperations';
import { scoringTeam } from '../lib/scoringRules';
import { reverseCompletingAction, scoringSideDelta } from '../lib/undo';

/**
 * Replays all remaining events AND manual score adjustments for a match and
 * writes the derived score state back to the database. Must be called after
 * any undo or delete operation so that set boundaries and match completion
 * reflect the current event log.
 *
 * Manual adjustments (ScoreAdjustment rows) are merged into the timeline by
 * timestamp, so a coach's correction survives subsequent undo/delete —
 * previously recalculation replayed events only and silently discarded them.
 *
 * NOTE: this is only valid while score state is fully DERIVED from the
 * timeline. A match under manual override (see applyEventRemoval) has set
 * boundaries no replay can reproduce, so callers must not use this on one.
 *
 * Inside a transaction pass its client (see loadScoreState).
 */
export async function recalculateMatchState(matchId: string, db: Prisma.TransactionClient = prisma): Promise<void> {
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: { status: true },
  });
  if (!match) return;

  const [events, adjustments] = await Promise.all([
    db.event.findMany({
      where: { matchId },
      select: { eventType: true, isOpponentEvent: true, recordedAt: true },
      // id breaks ties: taps sharing a timestamp must replay the same way every
      // time (cuids roughly follow insert order, like the increment path).
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    }),
    db.scoreAdjustment.findMany({
      where: { matchId },
      select: { homeDelta: true, awayDelta: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const timeline = buildTimeline(events, adjustments);
  const { homeScore, awayScore, homeSetsWon, awaySetsWon, setScores, completed } =
    replayTimeline(timeline);

  const newStatus =
    completed ? 'COMPLETED'
    : timeline.length > 0 ? 'IN_PROGRESS'
    : match.status === 'COMPLETED' ? 'IN_PROGRESS'
    : match.status;

  await db.match.update({
    where: { id: matchId },
    data: {
      homeScore,
      awayScore,
      homeSetsWon,
      awaySetsWon,
      setScores,
      status: newStatus,
    },
  });
}

/**
 * Brings match score state back in line after an event is undone or deleted.
 *
 * Normally that means a full replay. But once a coach has used a manual set
 * operation (End Set / Undo Set / Reset Match), the match's set boundaries are
 * authored rather than derived — a set force-ended at 18-12 is not something
 * replayTimeline could ever reconstruct from the events. Replaying such a match
 * would silently erase the override and its set history.
 *
 * So for an overridden match we reverse just the removed event's own point and
 * leave set state alone. The stat is still corrected and the running score
 * still moves; only the (no-longer-derivable) set boundaries are protected.
 *
 * The exception is an event carrying `completedSet`: that one DID move set
 * state, and reversing it against the (already zeroed) running score would undo
 * nothing while leaving the set banked. It gets the same banked-entry treatment
 * as the adjustment path — see lib/undo.ts reverseCompletingAction.
 */
export async function applyEventRemoval(
  matchId: string,
  event: { eventType: string; isOpponentEvent: boolean; completedSet?: boolean },
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      manualScoreOverride: true,
      homeScore: true,
      awayScore: true,
      homeSetsWon: true,
      awaySetsWon: true,
      setScores: true,
      status: true,
    },
  });
  if (!match) return;

  if (!match.manualScoreOverride) {
    // A replay rebuilds set boundaries from scratch, so it already handles a
    // set-completing event correctly — completedSet is not needed here.
    await recalculateMatchState(matchId, db);
    return;
  }

  const state: MatchScoreState = {
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeSetsWon: match.homeSetsWon,
    awaySetsWon: match.awaySetsWon,
    setScores: Array.isArray(match.setScores) ? (match.setScores as unknown as SetScoreEntry[]) : [],
    status: match.status,
  };

  if (event.completedSet) {
    const delta = scoringSideDelta(scoringTeam(event.eventType, event.isOpponentEvent));
    const uncompleted = reverseCompletingAction(state, delta);
    if (uncompleted) {
      await db.match.update({
        where: { id: matchId },
        data: {
          homeScore: uncompleted.homeScore,
          awayScore: uncompleted.awayScore,
          homeSetsWon: uncompleted.homeSetsWon,
          awaySetsWon: uncompleted.awaySetsWon,
          setScores: uncompleted.setScores,
          status: uncompleted.status as MatchStatus,
        },
      });
      return;
    }
    // No banked entry to rebuild from — fall through to the plain reversal
    // rather than corrupt set state.
  }

  // Set state is deliberately left alone here: this event didn't move it.
  const next = reverseEventScore(state, event.eventType, event.isOpponentEvent);

  await db.match.update({
    where: { id: matchId },
    data: { homeScore: next.homeScore, awayScore: next.awayScore },
  });
}
