// A queued offline tap carries the time it was made, so a set tracked with no
// signal replays in the order it happened, not the order it synced (6.2).
// Phones' clocks can be wrong, so a time outside the window is ignored and the
// server uses now() instead. It never fails the request: a tap must still save.
// A time slightly ahead (a fast clock) is accepted but clamped to now: the tap
// can't have happened after the server received it, and a future stamp would
// sort it after a later manual score change (undo, replay).

const MAX_AHEAD_MS = 2 * 60 * 1000;
// Seconds required; the app always sends toISOString() (milliseconds).
const ISO = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export type ClientTimeReason = 'accepted' | 'absent' | 'invalid' | 'too-late' | 'too-early';

export function acceptClientRecordedAt(
  raw: unknown,
  { now, matchCreatedAt }: { now: Date; matchCreatedAt: Date },
): { recordedAt: Date | null; reason: ClientTimeReason } {
  if (raw == null) return { recordedAt: null, reason: 'absent' };
  const m = typeof raw === 'string' ? ISO.exec(raw) : null;
  if (!m) return { recordedAt: null, reason: 'invalid' };
  // Date.parse rolls 31 Feb over into March; round-trip the calendar date.
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  const at = new Date(raw as string);
  if (Number.isNaN(at.getTime()) || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) {
    return { recordedAt: null, reason: 'invalid' };
  }
  if (at.getTime() > now.getTime() + MAX_AHEAD_MS) return { recordedAt: null, reason: 'too-late' };
  if (at.getTime() < matchCreatedAt.getTime()) return { recordedAt: null, reason: 'too-early' };
  return { recordedAt: at > now ? now : at, reason: 'accepted' };
}
