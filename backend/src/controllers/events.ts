import { Request, Response, NextFunction } from 'express';
import { MatchStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { checkSetCompletion, loadScoreState } from '../lib/scoring';
import { applyEventRemoval } from '../services/matchState.service';
import { resolveUndoTarget, reverseAdjustmentScore, reverseCompletingAction } from '../lib/undo';
import { redactEvents } from '../lib/playerPrivacy';
import { seesEveryPlayer } from '../services/permission.service';
import { recordOneEvent } from '../services/eventRecording.service';
import { parseEventInput } from '../lib/eventInput';
import { idempotencyKey, normalizeIdempotencyKey } from '../lib/idempotencyKey';

export async function recordEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const { event, duplicate } = await recordOneEvent(parseEventInput(req.body), idempotencyKey(req));
    // A duplicate is 200, not 201 like chat's: nothing new was created.
    res.status(duplicate ? 200 : 201).json(event);
  } catch (err) {
    next(err);
  }
}

// A whole offline set can be several hundred taps; one POST each would hit the
// per-user event limit, so a device flushes its queue in batches (6.4). Each
// item is its own serializable transaction (6-8 round trips, plus a replay if
// out of order): 50 took 2.3 s against a local database, which Supabase's
// latency could push toward Netlify's 10 s function timeout, so 20.
export const MAX_EVENT_BATCH = 20;

type BatchResult =
  | { clientKey: string; status: 'created' | 'duplicate'; event: unknown }
  | { clientKey: string; status: 'rejected'; error: string }
  | { clientKey: string; status: 'retry' };

/**
 * POST /api/v1/events/batch — { matchId, events: [...] }, each item a
 * POST /events body plus a required clientKey and optional recordedAt. The
 * guard checked TRACK_MATCH on the top-level matchId, so every item must be
 * for that match; a mismatch refuses the whole request before any write.
 *
 * Items run in order. A refused item (a 4xx) is reported and the rest carry
 * on; a serialization conflict stops there and marks it and every later item
 * `retry`, because order matters; anything else fails the whole request with
 * a 500, which the device resends (idempotency makes that safe).
 */
export async function recordEventBatch(req: Request, res: Response, next: NextFunction) {
  try {
    const { matchId, events } = req.body ?? {};
    if (typeof matchId !== 'string' || !Array.isArray(events) || events.length < 1 || events.length > MAX_EVENT_BATCH) {
      throw new AppError(400, `Send between 1 and ${MAX_EVENT_BATCH} events for one match.`);
    }
    const keys = events.map((item) => {
      if (typeof item !== 'object' || item === null || item.matchId !== matchId) {
        throw new AppError(400, 'Every event in a batch must be for the same match.');
      }
      const key = normalizeIdempotencyKey(item.clientKey);
      if (!key) throw new AppError(400, 'Every event in a batch needs a clientKey.');
      return key;
    });

    const results: BatchResult[] = [];
    for (let i = 0; i < events.length; i++) {
      const clientKey = keys[i];
      try {
        const { event, duplicate } = await recordOneEvent(parseEventInput(events[i]), clientKey);
        results.push({ clientKey, status: duplicate ? 'duplicate' : 'created', event });
      } catch (err) {
        if (err instanceof AppError && err.code === 'SERIALIZATION_CONFLICT') {
          for (const k of keys.slice(i)) results.push({ clientKey: k, status: 'retry' });
          break;
        }
        if (err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500) {
          results.push({ clientKey, status: 'rejected', error: err.message });
          continue;
        }
        throw err;
      }
    }
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

export async function getEventsByMatch(req: Request, res: Response, next: NextFunction) {
  try {
    const { setNumber } = req.query;
    const userId = req.user?.userId ?? null;
    const [events, isStaff] = await Promise.all([
      prisma.event.findMany({
        where: {
          matchId: req.params.matchId,
          ...(setNumber ? { setNumber: Number(setNumber) } : {}),
        },
        include: {
          player: { select: { firstName: true, lastName: true, jerseyNumber: true, userId: true } },
        },
        orderBy: { recordedAt: 'asc' },
      }),
      seesEveryPlayer(userId, res.locals.visibleTeamId), // set by visibleByMatchParam
    ]);
    res.json(redactEvents(events, isStaff, userId));
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
