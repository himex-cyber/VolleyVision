// Validation for one recorded event, shared by POST /events and each item of
// POST /events/batch (6.2). Pure, so it's unit-testable without a database.
// An unknown eventType or a non-numeric setNumber used to reach Prisma as a
// 500; in a batch that would look like a failed sync rather than a bad tap.

import { EventType } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { isEnumValue } from './feedbackValidation';

export interface EventInput {
  matchId: string;
  playerId: string | null;
  eventType: EventType;
  setNumber: number;
  rallyNumber: number | null;
  courtZone: number | null;
  rotationNumber: number | null;
  notes: string | null;
  isOpponentEvent: boolean;
  opponentJerseyNumber: number | null;
  /** Raw client time; lib/clientTime decides whether it's used. */
  recordedAt: unknown;
}

function intInRange(raw: unknown, min: number, max: number): number | null {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function parseEventInput(body: unknown): EventInput {
  if (typeof body !== 'object' || body === null) throw new AppError(400, 'matchId, eventType, and setNumber are required.');
  const {
    matchId, playerId, eventType, setNumber,
    rallyNumber, courtZone, rotationNumber, notes,
    isOpponentEvent, opponentJerseyNumber, recordedAt,
  } = body as Record<string, any>;

  const isOpponent = Boolean(isOpponentEvent);

  // Opponent events: playerId must be absent/null; opponentJerseyNumber is optional.
  if (!matchId || !eventType || setNumber == null || setNumber === '') {
    throw new AppError(400, 'matchId, eventType, and setNumber are required.');
  }
  if (!isEnumValue(EventType, eventType)) throw new AppError(400, 'Unknown event type.');
  const set = intInRange(setNumber, 1, 5);
  if (set == null) throw new AppError(400, 'Set number must be between 1 and 5.');
  if (!isOpponent && !playerId) {
    throw new AppError(400, 'playerId is required for non-opponent events.');
  }
  if (isOpponent && playerId) {
    throw new AppError(400, 'playerId must not be set for opponent events.');
  }
  if (courtZone != null && intInRange(courtZone, 1, 6) == null) {
    throw new AppError(400, 'Court zone must be between 1 and 6.');
  }
  if (rotationNumber != null && intInRange(rotationNumber, 1, 6) == null) {
    throw new AppError(400, 'Rotation number must be between 1 and 6.');
  }
  // Anything left unchecked would reach Prisma as a 500, and a batch that 500s
  // is resent as-is, so one bad field would stall a device's whole queue.
  if (typeof matchId !== 'string' || (playerId != null && typeof playerId !== 'string')) {
    throw new AppError(400, 'matchId and playerId must be ids.');
  }
  if (rallyNumber != null && intInRange(rallyNumber, 1, 10_000) == null) {
    throw new AppError(400, 'Rally number must be a positive whole number.');
  }
  // 500: twenty notes of multi-byte text must still fit express.json's 100 kB.
  if (notes != null && notes !== '' && (typeof notes !== 'string' || notes.length > 500)) {
    throw new AppError(400, 'Notes must be text of at most 500 characters.');
  }
  // Postgres refuses NUL in text, which would 500 (and stall) a batch.
  if ([matchId, playerId, notes].some((v) => typeof v === 'string' && v.includes('\0'))) {
    throw new AppError(400, 'Text fields must not contain NUL characters.');
  }

  return {
    matchId,
    playerId: isOpponent ? null : playerId,
    eventType,
    setNumber: set,
    rallyNumber: rallyNumber != null ? Number(rallyNumber) : null,
    courtZone: courtZone != null ? Number(courtZone) : null,
    rotationNumber: rotationNumber != null ? Number(rotationNumber) : null,
    notes: notes || null,
    isOpponentEvent: isOpponent,
    // Optional and typed by hand courtside: a number that isn't a jersey (-3,
    // 1000, 'x') is dropped rather than refusing the tap, which is a point.
    // v9.10.0 apps saved it before; a bad value is now simply not kept.
    opponentJerseyNumber: isOpponent ? intInRange(opponentJerseyNumber, 0, 999) : null,
    recordedAt,
  };
}
