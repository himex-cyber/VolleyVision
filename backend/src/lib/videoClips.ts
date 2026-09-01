// Pure clip maths: mapping tracked events onto video time, and validating
// ranges. No DB, no network.
//
// A clip is a time RANGE, never a file. YouTube playback is a cross-origin
// iframe — nothing can be cut, exported, or served — so a clip is two numbers
// the player seeks between. Nothing here should ever assume access to bytes.

import { AppError } from '../middleware/errorHandler';

/**
 * A statistician taps the button *after* seeing the action, so the rally sits
 * BEFORE the recorded instant. Pre-roll is therefore much larger than
 * post-roll: 10 s comfortably covers serve → pass → set → attack, while 4 s is
 * enough to see the ball land and the point resolve.
 */
export const CLIP_PRE_ROLL_SECONDS = 10;
export const CLIP_POST_ROLL_SECONDS = 4;

/** Upper bound on a clip, so one can't silently span the whole match. */
export const MAX_CLIP_LENGTH_SECONDS = 600; // 10 minutes

export interface ClipRange {
  startSeconds: number;
  endSeconds: number;
}

/**
 * Position in the video of an event, in whole seconds.
 *
 * Both operands come from the same clock: recordingStartedAt was itself derived
 * from an event's recordedAt during calibration. That is why device clock skew
 * cancels out instead of accumulating — the anchor is a real event, not a
 * wall-clock assumption.
 *
 * Can be negative when the event predates the video (a match filmed from set 2).
 */
export function eventToVideoSeconds(recordedAt: Date, recordingStartedAt: Date): number {
  return Math.floor((recordedAt.getTime() - recordingStartedAt.getTime()) / 1000);
}

/**
 * Clip window around an event, clamped to the video.
 *
 * Returns null when the event falls outside the footage entirely — before it
 * starts or after it ends — which the caller skips and counts rather than
 * treating as an error. A match filmed across three set-videos will have most
 * of its events outside any given one; that is normal, not a failure.
 */
export function clipRangeForEvent(videoSeconds: number, durationSeconds: number | null): ClipRange | null {
  // Past the end of known footage.
  if (durationSeconds !== null && videoSeconds > durationSeconds) return null;

  const endSeconds = durationSeconds !== null
    ? Math.min(videoSeconds + CLIP_POST_ROLL_SECONDS, durationSeconds)
    : videoSeconds + CLIP_POST_ROLL_SECONDS;

  // Before the video begins. Checked against the clip END, not the event: an
  // event 3 s before 0:00 still has its aftermath on camera and is worth
  // keeping, clamped to start at 0.
  if (endSeconds <= 0) return null;

  const startSeconds = Math.max(videoSeconds - CLIP_PRE_ROLL_SECONDS, 0);

  // Can happen when duration clamping pulls the end back to the start.
  if (endSeconds <= startSeconds) return null;

  return { startSeconds, endSeconds };
}

/**
 * Validate a coach-supplied range. Throws AppError(400) with a user-facing
 * message — the same rules the DB check constraint enforces, stated in language
 * a person can act on.
 */
export function validateClipRange(input: {
  startSeconds: unknown;
  endSeconds: unknown;
  durationSeconds?: number | null;
}): ClipRange {
  const { startSeconds, endSeconds, durationSeconds = null } = input;

  if (!isWholeSecond(startSeconds) || !isWholeSecond(endSeconds)) {
    throw new AppError(400, 'Clip start and end must be whole numbers of seconds.');
  }
  if (startSeconds < 0) {
    throw new AppError(400, 'A clip cannot start before the video does.');
  }
  if (endSeconds <= startSeconds) {
    throw new AppError(400, 'A clip must end after it starts.');
  }
  if (endSeconds - startSeconds > MAX_CLIP_LENGTH_SECONDS) {
    throw new AppError(400, `A clip can be at most ${MAX_CLIP_LENGTH_SECONDS / 60} minutes long.`);
  }
  if (durationSeconds !== null && endSeconds > durationSeconds) {
    throw new AppError(400, 'A clip cannot end after the video does.');
  }

  return { startSeconds, endSeconds };
}

function isWholeSecond(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/** `1:23` / `1:02:03` — tabular timecode for labels and logs. */
export function formatTimecode(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}
