// A match's date is the time printed on the fixture, in whatever time zone the
// game is played (8.0.7): wall-clock time, kept as UTC. The web forms send a
// naive datetime-local string ("2026-09-30T19:00"); new Date() read that in
// the server's own zone (UTC on Netlify, NZ on a dev machine), so the same
// entry was stored 13 hours apart. A naive value is now stored as written.
// Kept free of Prisma, so `npm test` can run it.

const NAIVE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;
const MIN_YEAR = 1900; // as lib/dateWindow.ts: Date reads years 0-99 as 19xx
const MAX_YEAR = 9998;

/** The stored Date for a match date from a request, or null if it isn't a real one. */
export function parseMatchDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const naive = NAIVE.exec(value);
  const date = new Date(naive ? `${value}Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() < MIN_YEAR || date.getUTCFullYear() > MAX_YEAR) return null;
  if (naive) {
    // Date rolls 2026-02-30 over to 2 March, and 24:30 into the next day.
    const [y, mo, d, h, mi] = naive.slice(1, 6).map(Number);
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d
      || date.getUTCHours() !== h || date.getUTCMinutes() !== mi) return null;
  }
  return date;
}

const FOURTEEN_HOURS = 14 * 60 * 60 * 1000; // the widest UTC offsets are -12 and +14

/**
 * What "now" means when listing upcoming matches (9.0.6). Match dates are
 * wall-clock time kept as UTC, so they must be compared with the device's wall
 * clock, not UTC now (an NZ game stayed "upcoming" ~13 h after it started).
 * Only a naive value is taken: parseMatchDate would turn a Z or offset string
 * into real UTC, which defeats the point. Anything else, or anything more than
 * 14 hours from real now, falls back to real now (old apps send nothing).
 */
export function upcomingFrom(localNow: unknown, now: Date = new Date()): Date {
  if (typeof localNow !== 'string' || !NAIVE.test(localNow)) return now;
  const local = parseMatchDate(localNow);
  return local && Math.abs(local.getTime() - now.getTime()) <= FOURTEEN_HOURS ? local : now;
}
