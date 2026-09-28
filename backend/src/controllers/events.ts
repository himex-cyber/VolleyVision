import { Request, Response, NextFunction } from 'express';
import { MatchStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { checkSetCompletion, loadScoreState } from '../lib/scoring';
import { scoringTeam } from '../lib/scoringRules';
import { applyEventRemoval } from '../services/matchState.service';
import { resolveUndoTarget, reverseAdjustmentScore, reverseCompletingAction } from '../lib/undo';
import { redactEvents } from '../lib/playerPrivacy';
import { seesEveryPlayer } from '../services/permission.service';

export async function recordEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      matchId, playerId, eventType, setNumber,
      rallyNumber, courtZone, rotationNumber, notes,
      isOpponentEvent, opponentJerseyNumber,
    } = req.body;

    const isOpponent = Boolean(isOpponentEvent);

    // ── Validation — gated on isOpponentEvent ─────────────────────────────────
    // Normal (own-player) events: identical requirement to before this change.
    // Opponent events: playerId must be absent/null; opponentJerseyNumber is optional.
    if (!matchId || !eventType || !setNumber) {
      throw new AppError(400, 'matchId, eventType, and setNumber are required.');
    }
    if (!isOpponent && !playerId) {
      throw new AppError(400, 'playerId is required for non-opponent events.');
    }
    if (isOpponent && playerId) {
      throw new AppError(400, 'playerId must not be set for opponent events.');
    }

    // M3: playerId came from the request body with no check that the player
    // actually belongs to the match's team — any team member with TRACK_MATCH
    // could attribute a stat to an arbitrary player on an unrelated roster.
    // A player belongs via their home team (Player.teamId) or a PlayerTeamLink.
    if (!isOpponent && playerId) {
      const match = await prisma.match.findUnique({ where: { id: matchId }, select: { teamId: true } });
      if (!match) throw new AppError(404, 'Match not found.');
      const eligible = await prisma.player.findFirst({
        where: {
          id: playerId,
          OR: [{ teamId: match.teamId }, { teamLinks: { some: { teamId: match.teamId } } }],
        },
        select: { id: true },
      });
      if (!eligible) throw new AppError(400, 'Player does not belong to this match\'s team.');
    }

    if (courtZone != null) {
      const zone = Number(courtZone);
      if (!Number.isInteger(zone) || zone < 1 || zone > 6) {
        throw new AppError(400, 'Court zone must be between 1 and 6.');
      }
    }

    if (rotationNumber != null) {
      const rot = Number(rotationNumber);
      if (!Number.isInteger(rot) || rot < 1 || rot > 6) {
        throw new AppError(400, 'Rotation number must be between 1 and 6.');
      }
    }

    const event = await prisma.event.create({
      data: {
        matchId,
        playerId:            isOpponent ? null : playerId,
        eventType,
        setNumber:           Number(setNumber),
        rallyNumber:         rallyNumber    != null ? Number(rallyNumber)    : null,
        courtZone:           courtZone      != null ? Number(courtZone)      : null,
        rotationNumber:      rotationNumber != null ? Number(rotationNumber) : null,
        notes:               notes || null,
        isOpponentEvent:     isOpponent,
        opponentJerseyNumber:isOpponent && opponentJerseyNumber != null
                               ? Number(opponentJerseyNumber)
                               : null,
      },
      include: { player: { select: { firstName: true, lastName: true, jerseyNumber: true } } },
    });

    const team = scoringTeam(eventType, isOpponent);
    if (team === 'home' || team === 'away') {
      await prisma.match.update({
        where: { id: matchId },
        data: team === 'home' ? { homeScore: { increment: 1 } } : { awayScore: { increment: 1 } },
      });

      // Mark the event that closed the set, for the same reason updateScore
      // marks the adjustment: completion zeroes the running score, so an undo
      // under manualScoreOverride (which can't replay) would otherwise reverse
      // against the wrong baseline. See lib/undo.ts.
      const completedSet = await checkSetCompletion(matchId);
      if (completedSet) {
        await prisma.event.update({ where: { id: event.id }, data: { completedSet: true } });
      }
    }

    res.status(201).json(event);
  } catch (err) {
    next(err);
  }
}

export async function getEventsByMatch(req: Request, res: Response, next: NextFunction) {
  try {
    const { setNumber } = req.query;
    const events = await prisma.event.findMany({
      where: {
        matchId: req.params.matchId,
        ...(setNumber ? { setNumber: Number(setNumber) } : {}),
      },
      include: {
        player: { select: { firstName: true, lastName: true, jerseyNumber: true, userId: true } },
      },
      orderBy: { recordedAt: 'asc' },
    });
    // The visibility guard already resolved the match; this re-read is one
    // indexed lookup for its team, which the per-player rule needs.
    const match = await prisma.match.findUnique({ where: { id: req.params.matchId }, select: { teamId: true } });
    const userId = req.user?.userId ?? null;
    res.json(redactEvents(events, !!match && await seesEveryPlayer(userId, match.teamId), userId));
  } catch (err) {
    next(err);
  }
}

// Undo the last thing that happened on a match.
//
// A manual score tap (+1 / −) does NOT create an Event — updateScore writes a
// ScoreAdjustment instead. Looking only at the Event table therefore skipped
// straight past a score tap and reversed the older stat event behind it, which
// read as "undo minuses the score again". So compare both logs and undo
// whichever actually happened last.
export async function deleteLastEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const matchId = req.params.matchId;

    const [latestEvent, latestAdjustment] = await Promise.all([
      prisma.event.findFirst({ where: { matchId }, orderBy: { recordedAt: 'desc' } }),
      prisma.scoreAdjustment.findFirst({ where: { matchId }, orderBy: { createdAt: 'desc' } }),
    ]);

    const target = resolveUndoTarget(latestEvent, latestAdjustment);
    if (!target) throw new AppError(404, 'No events to undo.');

    if (target === 'adjustment') {
      const adjustment = latestAdjustment!;
      const state = await loadScoreState(matchId);
      if (!state) throw new AppError(404, 'Match not found.');

      // The tap that closed a set can't be reversed against the current score —
      // completion already zeroed it. Rebuild from the banked setScores entry
      // instead, and undo the completion along with the point.
      const uncompleted = adjustment.completedSet ? reverseCompletingAction(state, adjustment) : null;

      if (uncompleted) {
        await prisma.$transaction([
          prisma.match.update({
            where: { id: matchId },
            data: {
              homeScore: uncompleted.homeScore,
              awayScore: uncompleted.awayScore,
              homeSetsWon: uncompleted.homeSetsWon,
              awaySetsWon: uncompleted.awaySetsWon,
              setScores: uncompleted.setScores,
              status: uncompleted.status as MatchStatus,
            },
          }),
          prisma.scoreAdjustment.delete({ where: { id: adjustment.id } }),
        ]);
        // Deliberately no checkSetCompletion here: we just un-completed this
        // set on purpose, and the restored score is pre-threshold by definition.
        res.json({ deleted: adjustment.id, kind: 'adjustment', uncompletedSet: true });
        return;
      }

      // A direct, symmetrical reversal — not applyEventRemoval, which is
      // event-specific. Both writes go in one transaction so the score and the
      // adjustment log can't disagree if one of them fails.
      const reversed = reverseAdjustmentScore(state, adjustment);
      await prisma.$transaction([
        prisma.match.update({
          where: { id: matchId },
          data: { homeScore: reversed.homeScore, awayScore: reversed.awayScore },
        }),
        prisma.scoreAdjustment.delete({ where: { id: adjustment.id } }),
      ]);

      // Mirrors updateScore, which checks after every manual score change:
      // reversing a negative adjustment raises the score and could carry a set.
      await checkSetCompletion(matchId);
      res.json({ deleted: adjustment.id, kind: 'adjustment' });
      return;
    }

    const event = latestEvent!;
    await prisma.event.delete({ where: { id: event.id } });
    // matchId is guaranteed here (queried by matchId); guard for the nullable type.
    if (event.matchId) await applyEventRemoval(event.matchId, event);
    res.json({ deleted: event.id, kind: 'event' });
  } catch (err) {
    next(err);
  }
}

// Delete a specific event by ID (admin correction).
export async function deleteEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!event) throw new AppError(404, 'Event not found.');
    await prisma.event.delete({ where: { id: event.id } });
    // Only match events affect match state; training events (matchId null) don't.
    if (event.matchId) await applyEventRemoval(event.matchId, event);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
