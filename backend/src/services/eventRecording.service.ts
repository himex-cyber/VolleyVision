import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { checkSetCompletion } from '../lib/scoring';
import { scoringTeam } from '../lib/scoringRules';
import { acceptClientRecordedAt } from '../lib/clientTime';
import { isOutOfOrder } from '../lib/offlineOrder';
import type { EventInput } from '../lib/eventInput';
import { recalculateMatchState } from './matchState.service';

const eventInclude = {
  player: { select: { firstName: true, lastName: true, jerseyNumber: true } },
} as const;

type RecordedEvent = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';

/**
 * Records one tracked event: POST /events and each item of POST /events/batch
 * (6.3). The caller has passed requireEventPermission(TRACK_MATCH) on
 * input.matchId.
 *
 * Idempotent: a clientKey already recorded on this match returns that row with
 * `duplicate: true` and no score change, so a phone that lost the response can
 * resend. Atomic: the create, the score, set completion and the completedSet
 * mark are one transaction (they used to be four separate writes). Order-aware:
 * an offline tap carries the time it was made; if it lands before something
 * already recorded, the match is replayed rather than incremented, because the
 * set boundaries after it may move.
 *
 * Old apps send no key and no time: identical to before, only atomic.
 */
export async function recordOneEvent(
  input: EventInput,
  clientKey: string | null,
): Promise<{ event: RecordedEvent; duplicate: boolean }> {
  const { matchId } = input;

  const findExisting = (db: Prisma.TransactionClient, key: string) =>
    db.event.findUnique({ where: { matchId_clientKey: { matchId, clientKey: key } }, include: eventInclude });

  try {
    // Read Committed plus a lock on the match row, not runSerializable: every
    // tap on a match updates that one row, so under SERIALIZABLE a device
    // flushing a batch made a live tap from the web or a v9.10.0 app lose with
    // a 409 that those clients show as "Couldn't save that event". The lock
    // makes writers on one match wait their turn instead, and each statement
    // sees what the one before it committed, so a resend of the same key
    // queued behind the original finds its row.
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "matches" WHERE "id" = ${matchId} FOR UPDATE`;

      if (clientKey) {
        const existing = await findExisting(tx, clientKey);
        if (existing) return { event: existing, duplicate: true };
      }

      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: { teamId: true, createdAt: true, manualScoreOverride: true },
      });
      if (!match) throw new AppError(404, 'Match not found.');

      // M3: playerId came from the request body with no check that the player
      // actually belongs to the match's team — any team member with TRACK_MATCH
      // could attribute a stat to an arbitrary player on an unrelated roster.
      // A player belongs via their home team (Player.teamId) or a PlayerTeamLink.
      // After the key lookup: a resend of a tap already saved stays a duplicate
      // even if the player has been unlinked since.
      if (input.playerId) {
        const eligible = await tx.player.findFirst({
          where: {
            id: input.playerId,
            OR: [{ teamId: match.teamId }, { teamLinks: { some: { teamId: match.teamId } } }],
          },
          select: { id: true },
        });
        if (!eligible) throw new AppError(400, 'Player does not belong to this match\'s team.');
      }

      const now = new Date();
      // Under manual override points are applied in arrival order (no replay
      // can reproduce authored set boundaries), so the stored time must be
      // arrival time too, or undo would pick a different "last" point than
      // the one applied last.
      const time = match.manualScoreOverride
        ? { recordedAt: null, reason: 'absent' as const }
        : acceptClientRecordedAt(input.recordedAt, { now, matchCreatedAt: match.createdAt });
      if (time.reason !== 'accepted' && time.reason !== 'absent') {
        console.warn(`[events] client recordedAt ignored (${time.reason}) on match ${matchId}; used server time`);
      }
      const recordedAt = time.recordedAt ?? now;

      // Before the create: afterwards the new row is the latest and every
      // event would look in order.
      const [latestEvent, latestAdjustment] = await Promise.all([
        tx.event.findFirst({ where: { matchId }, orderBy: { recordedAt: 'desc' }, select: { recordedAt: true } }),
        tx.scoreAdjustment.findFirst({ where: { matchId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      ]);
      const outOfOrder = isOutOfOrder(recordedAt, latestEvent?.recordedAt ?? null, latestAdjustment?.createdAt ?? null);

      let event = await tx.event.create({
        data: {
          matchId,
          playerId: input.playerId,
          eventType: input.eventType,
          setNumber: input.setNumber,
          rallyNumber: input.rallyNumber,
          courtZone: input.courtZone,
          rotationNumber: input.rotationNumber,
          notes: input.notes,
          isOpponentEvent: input.isOpponentEvent,
          opponentJerseyNumber: input.opponentJerseyNumber,
          clientKey,
          recordedAt,
        },
        include: eventInclude,
      });

      const team = scoringTeam(input.eventType, input.isOpponentEvent);
      if (team === 'home' || team === 'away') {
        // Under manual override the set boundaries are authored, and no replay
        // can reproduce them (matchState.service), so points there only
        // increment, the documented behaviour before 6.3 too.
        if (!outOfOrder || match.manualScoreOverride) {
          await tx.match.update({
            where: { id: matchId },
            data: team === 'home' ? { homeScore: { increment: 1 } } : { awayScore: { increment: 1 } },
          });
          // Mark the event that closed the set, for the same reason updateScore
          // marks the adjustment: completion zeroes the running score, so an
          // undo under manualScoreOverride (which can't replay) would otherwise
          // reverse against the wrong baseline. See lib/undo.ts.
          if (await checkSetCompletion(matchId, tx)) {
            event = await tx.event.update({ where: { id: event.id }, data: { completedSet: true }, include: eventInclude });
          }
        } else {
          // ponytail: the replay doesn't rewrite other events' completedSet
          // marks; they only matter once a match goes to manual override.
          await recalculateMatchState(matchId, tx);
        }
      }

      return { event, duplicate: false };
    }, { isolationLevel: 'ReadCommitted' });
  } catch (err) {
    // Belt and braces: the lock orders resends, but the unique index is the
    // guarantee.
    if (clientKey && isUniqueViolation(err)) {
      const existing = await findExisting(prisma, clientKey);
      if (existing) return { event: existing, duplicate: true };
    }
    throw err;
  }
}
