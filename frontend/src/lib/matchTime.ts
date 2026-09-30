// Match.matchDate is the time printed on the fixture, in whatever zone the game
// is played, stored as UTC (a 6 pm game is 18:00:00Z). Formatting it in the
// browser's zone would shift it (12-13 h in NZ), so always render it as UTC.
// Only for matchDate: never use for real instants like recordedAt/generatedAt.

export function formatMatchDate(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(d);
}

/**
 * The device's wall-clock time as a naive "YYYY-MM-DDTHH:mm", comparable with
 * stored match dates. Sent as ?localNow= so "upcoming" means not started yet
 * where the user is, not in UTC (9.0.6).
 */
export function localNow(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`;
}

/** Value for `<input type="datetime-local">`: the stored wall-clock time. */
export function toDateTimeLocal(value: string | Date): string {
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16);
}
