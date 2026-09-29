// The from/to date range of the matches list and the cross-match analytics
// routes (8.1). Kept free of Prisma, so `npm test` can run it.
//
// Days are UTC days, matching how match times are stored (wall-clock time on
// the fixture, see 8.0.7). `to` includes its whole day: the window ends at the
// next midnight, exclusive. new Date('x') used to reach Prisma and come back
// as a 500; anything that isn't a real YYYY-MM-DD is a 400 message instead.

export type DateWindow = { gte?: Date; lt?: Date };

export type DateWindowResult =
  | { ok: true; window: DateWindow | null } // null: no range, today's behaviour
  | { ok: false; message: string };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const FORMAT = 'Dates must look like 2026-09-30.';
const MIN_YEAR = 1900; // lib/dateRange.ts on the client holds the same bounds
const MAX_YEAR = 9998;

/** Midnight UTC of a YYYY-MM-DD day, or null if it isn't one (2026-02-30 included). */
function utcDay(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = DAY.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Date.UTC reads years 0-99 as 1900-1999, and 9999-12-31's end (year
  // 10000) is past what Postgres stores: a 500. No match lives out there.
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  // Date.UTC rolls 2026-02-30 over to 2 March; a real day round-trips.
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

export function parseDateWindow(q: { from?: unknown; to?: unknown }): DateWindowResult {
  if (q.from === undefined && q.to === undefined) return { ok: true, window: null };
  const from = q.from === undefined ? undefined : utcDay(q.from);
  const to = q.to === undefined ? undefined : utcDay(q.to);
  if (from === null || to === null) return { ok: false, message: FORMAT };
  if (from && to && from > to) return { ok: false, message: 'The start date is after the end date.' };
  const window: DateWindow = {};
  if (from) window.gte = from;
  if (to) window.lt = new Date(to.getTime() + 24 * 60 * 60 * 1000);
  return { ok: true, window };
}

/** Spread into a Prisma `match` where clause: `{ matchDate: window }`, or nothing. */
export function matchDateWhere(window: DateWindow | null): { matchDate?: DateWindow } {
  return window ? { matchDate: window } : {};
}
