import { Request, Response, NextFunction } from 'express';
import { AccessTier, ApprovalAction, MatchStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { checkSetCompletion, loadScoreState } from '../lib/scoring';
// Re-add `completeSet, leadingSide` here if the endSet controller below is
// ever restored. `completeSet` is still very much live — lib/scoring.ts calls
// it for automatic set completion; it's just no longer used from this file.
import { resetMatchScore } from '../lib/setOperations';
import type { MatchScoreState } from '../lib/setOperations';
import { logAudit } from '../lib/audit';
import { getAccessTier } from '../services/permission.service';
import { createApprovalRequest } from '../services/approval.service';
import { applyCreateMatch, applyUpdateMatch, applyDeleteMatch } from '../services/teamActions.service';

// Response body when a non-head-coach action is queued for approval.
const pending = (requestId: string) => ({ status: 'pending_approval' as const, requestId });

export async function getMatchesByTeam(req: Request, res: Response, next: NextFunction) {
  try {
    const { opponent, status, from, to } = req.query as Record<string, string | undefined>;

    const matches = await prisma.match.findMany({
      where: {
        teamId: req.params.teamId,
        ...(opponent ? { opponent: { contains: opponent, mode: 'insensitive' } } : {}),
        ...(status   ? { status: status as any } : {}),
        ...(from || to ? {
          matchDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
      },
      include: { _count: { select: { events: true } } },
      orderBy: { matchDate: 'desc' },
    });
    res.json(matches);
  } catch (err) {
    next(err);
  }
}

export async function getMatch(req: Request, res: Response, next: NextFunction) {
  try {
    const match = await prisma.match.findUnique({
      where: { id: req.params.id },
      include: {
        team: { include: { players: { orderBy: { jerseyNumber: 'asc' } } } },
        // scoreAdjustments counts toward "is there anything to undo" — a manual
        // score tap is undoable but records no Event. See deleteLastEvent.
        _count: { select: { events: true, scoreAdjustments: true } },
      },
    });
    if (!match) throw new AppError(404, 'Match not found.');
    res.json(match);
  } catch (err) {
    next(err);
  }
}

export async function createMatch(req: Request, res: Response, next: NextFunction) {
  try {
    const { teamId, matchDate, opponent, competition, venue } = req.body;
    if (!teamId || !matchDate || !opponent) {
      throw new AppError(400, 'Team, date, and opponent are required.');
    }
    const userId = req.user!.userId;

    // Match-management access tier decides immediate vs queued (VIEW_ONLY/non-member
    // already 403'd upstream). Live tracking is a separate, untiered permission.
    if ((await getAccessTier(userId, teamId, 'match')) === AccessTier.FULL_ACCESS) {
      const match = await applyCreateMatch({ teamId, matchDate, opponent, competition, venue });
      logAudit(userId, 'CREATE_MATCH', 'match', match.id);
      return res.status(201).json(match);
    }

    const request = await createApprovalRequest({
      teamId, requestedById: userId, action: ApprovalAction.MATCH_CREATE,
      payload: { teamId, matchDate, opponent, competition: competition ?? null, venue: venue ?? null },
    });
    res.status(202).json(pending(request.id));
  } catch (err) {
    next(err);
  }
}

export async function updateMatch(req: Request, res: Response, next: NextFunction) {
  try {
    const { matchDate, opponent, competition, venue, status, setScores } = req.body;
    if (status && !Object.values(MatchStatus).includes(status)) {
      throw new AppError(400, 'Invalid match status.');
    }
    const existing = await prisma.match.findUnique({ where: { id: req.params.id }, select: { teamId: true } });
    if (!existing) throw new AppError(404, 'Match not found.');
    const userId = req.user!.userId;

    if ((await getAccessTier(userId, existing.teamId, 'match')) === AccessTier.FULL_ACCESS) {
      const match = await applyUpdateMatch(req.params.id, { matchDate, opponent, competition, venue, status, setScores });
      logAudit(userId, 'UPDATE_MATCH', 'match', match.id);
      return res.json(match);
    }

    const request = await createApprovalRequest({
      teamId: existing.teamId, requestedById: userId, action: ApprovalAction.MATCH_UPDATE,
      targetId: req.params.id,
      payload: { matchDate, opponent, competition, venue, status, setScores },
    });
    res.status(202).json(pending(request.id));
  } catch (err) {
    next(err);
  }
}

export async function deleteMatch(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.match.findUnique({ where: { id: req.params.id }, select: { teamId: true } });
    if (!existing) throw new AppError(404, 'Match not found.');
    const userId = req.user!.userId;

    if ((await getAccessTier(userId, existing.teamId, 'match')) === AccessTier.FULL_ACCESS) {
      await applyDeleteMatch(req.params.id);
      logAudit(userId, 'DELETE_MATCH', 'match', req.params.id);
      return res.status(204).send();
    }

    const request = await createApprovalRequest({
      teamId: existing.teamId, requestedById: userId, action: ApprovalAction.MATCH_DELETE,
      targetId: req.params.id, payload: {},
    });
    res.status(202).json(pending(request.id));
  } catch (err) {
    next(err);
  }
}

// Phase 4 Sprint 1 — manual score adjustment (home/away delta or absolute)
// Stabilization: also persists the change as a ScoreAdjustment delta so it
// survives recalculateMatchState after undo/delete operations.
export async function updateScore(req: Request, res: Response, next: NextFunction) {
  try {
    const { homeScore, awayScore, homeSetsWon, awaySetsWon } = req.body;

    const existing = await prisma.match.findUnique({
      where: { id: req.params.id },
      select: { homeScore: true, awayScore: true, homeSetsWon: true, awaySetsWon: true },
    });
    if (!existing) throw new AppError(404, 'Match not found.');

    // API keeps absolute-value semantics; the delta is derived for persistence.
    const homeDelta = homeScore != null ? Number(homeScore) - existing.homeScore : 0;
    const awayDelta = awayScore != null ? Number(awayScore) - existing.awayScore : 0;

    let adjustmentId: string | null = null;
    if (homeDelta !== 0 || awayDelta !== 0) {
      const currentSet = existing.homeSetsWon + existing.awaySetsWon + 1;
      const adjustment = await prisma.scoreAdjustment.create({
        data: { matchId: req.params.id, homeDelta, awayDelta, setNumber: currentSet },
      });
      adjustmentId = adjustment.id;
    }

    const match = await prisma.match.update({
      where: { id: req.params.id },
      data: {
        ...(homeScore != null ? { homeScore: Number(homeScore) } : {}),
        ...(awayScore != null ? { awayScore: Number(awayScore) } : {}),
        ...(homeSetsWon != null ? { homeSetsWon: Number(homeSetsWon) } : {}),
        ...(awaySetsWon != null ? { awaySetsWon: Number(awaySetsWon) } : {}),
      },
    });

    // Check if the manual update completed a set. If it did, mark the very
    // adjustment that caused it — completion zeroes the running score, so undo
    // can't work this out later and needs the flag to find the right baseline.
    const completedSet = await checkSetCompletion(req.params.id);
    if (completedSet && adjustmentId) {
      await prisma.scoreAdjustment.update({ where: { id: adjustmentId }, data: { completedSet: true } });
    }

    res.json(match);
  } catch (err) {
    next(err);
  }
}

// Phase 4 Sprint 1 — reset current set score (called at end of set)
// Stabilization: also clears that set's manual adjustments so the reset
// isn't undone by the next recalculation replaying stale deltas.
export async function resetSetScore(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.match.findUnique({
      where: { id: req.params.id },
      select: { homeSetsWon: true, awaySetsWon: true },
    });
    if (!existing) throw new AppError(404, 'Match not found.');

    const currentSet = existing.homeSetsWon + existing.awaySetsWon + 1;
    await prisma.scoreAdjustment.deleteMany({
      where: { matchId: req.params.id, setNumber: currentSet },
    });

    // The reset is authored, like Reset Match: no replay of the events can
    // reproduce it, and an out-of-order offline tap (6.3) or an undo would
    // replay the set straight back to its old score. Override makes both
    // adjust the running score instead.
    const match = await prisma.match.update({
      where: { id: req.params.id },
      data: { homeScore: 0, awayScore: 0, manualScoreOverride: true },
    });
    res.json(match);
  } catch (err) {
    next(err);
  }
}

// ─── Manual set overrides ─────────────────────────────────────────────────────
//
// These declare set boundaries that the event timeline cannot reproduce (a set
// force-ended at 18-12 is not derivable from the events). They therefore set
// manualScoreOverride, which stops applyEventRemoval from rebuilding set state
// by replay and silently erasing the coach's decision. See
// services/matchState.service.ts.

/** Persists a pure set-operation result, marking the match as manually overridden. */
async function writeOverriddenState(matchId: string, next: MatchScoreState) {
  return prisma.match.update({
    where: { id: matchId },
    data: {
      homeScore: next.homeScore,
      awayScore: next.awayScore,
      homeSetsWon: next.homeSetsWon,
      awaySetsWon: next.awaySetsWon,
      setScores: next.setScores,
      status: next.status as MatchStatus,
      manualScoreOverride: true,
    },
  });
}

// Manually end the current set in favour of whoever leads, without requiring
// the 25/15-point threshold — for forfeits, abandoned sets, or unsticking a
// bad state. Runs the same completion effects as the automatic path.
//
// DISABLED: this complicated the live-tracking flow in hands-on testing, so the
// scoreboard no longer offers it and its route in routes/matches.ts is not
// registered. Kept here for possible future use. Automatic set completion at
// 25/15 win-by-2 goes through checkSetCompletion in lib/scoring.ts and is a
// separate path — it is unaffected by this being disabled.
//
// export async function endSet(req: Request, res: Response, next: NextFunction) {
//   try {
//     const state = await loadScoreState(req.params.id);
//     if (!state) throw new AppError(404, 'Match not found.');
//
//     const winner = leadingSide(state);
//     if (!winner) {
//       throw new AppError(400, 'Cannot end a tied set — there is no winner to award it to.');
//     }
//
//     // The set's own adjustments are folded into the recorded score, so drop
//     // them; leaving them would let a later replay re-apply the same points.
//     await prisma.scoreAdjustment.deleteMany({
//       where: { matchId: req.params.id, setNumber: state.homeSetsWon + state.awaySetsWon + 1 },
//     });
//
//     const match = await writeOverriddenState(req.params.id, completeSet(state, winner));
//     res.json(match);
//   } catch (err) {
//     next(err);
//   }
// }

// Reset the whole match: zero the running score and sets won, clear the set
// history, and reopen a completed match. Broader than resetSetScore, which
// only zeroes the current set. Gated behind a confirm() on the client.
//
// Recorded stat events are deliberately KEPT. This is an analytics app — who
// dug or killed what shouldn't silently disappear because the scoreboard was
// reset. That leaves those events as the only thing predating the reset, so we
// write an audit entry recording what the reset actually wiped.
export async function resetMatch(req: Request, res: Response, next: NextFunction) {
  try {
    const state = await loadScoreState(req.params.id);
    if (!state) throw new AppError(404, 'Match not found.');

    // Every adjustment belonged to a set that no longer exists.
    const { count: scoreAdjustmentsDeleted } = await prisma.scoreAdjustment.deleteMany({
      where: { matchId: req.params.id },
    });
    const eventsKept = await prisma.event.count({ where: { matchId: req.params.id } });

    const match = await writeOverriddenState(req.params.id, resetMatchScore(state));

    logAudit(req.user!.userId, 'RESET_MATCH', 'match', req.params.id, {
      clearedHomeScore: state.homeScore,
      clearedAwayScore: state.awayScore,
      clearedHomeSetsWon: state.homeSetsWon,
      clearedAwaySetsWon: state.awaySetsWon,
      clearedSetScores: state.setScores,
      clearedStatus: state.status,
      scoreAdjustmentsDeleted,
      eventsKept,
    });

    res.json(match);
  } catch (err) {
    next(err);
  }
}
