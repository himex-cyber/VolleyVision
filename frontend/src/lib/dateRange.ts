import { useSearchParams } from 'react-router-dom';
import { format, isValid, parseISO } from 'date-fns';
import type { DateRange } from '../types';

// The server 400s anything else, and the dashboards' error state has no
// filter to recover with, so a hand-edited URL is dropped, not sent: only real
// days (not 2026-02-30), and never a start after the end.
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (s: string | null): s is string => !!s && YMD.test(s) && isValid(parseISO(s)) && format(parseISO(s), 'yyyy-MM-dd') === s;

/** One source for pages and drill-down links: the range held in the URL. */
export function useDateRangeParams(): DateRange {
  const [params] = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  if (realDay(from) && realDay(to) && from > to) return {};
  return {
    ...(realDay(from) ? { from } : {}),
    ...(realDay(to) ? { to } : {}),
  };
}

/** Query-string tail ("&from=…&to=…") for links that carry the range along. */
export function rangeQuery(range?: DateRange): string {
  return (range?.from ? `&from=${range.from}` : '') + (range?.to ? `&to=${range.to}` : '');
}

// Local time on purpose: toISOString() is UTC and shifts the day in New Zealand.
export const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const show = (s: string, withYear: boolean) => format(parseISO(s), withYear ? 'd MMM yyyy' : 'd MMM');

/** "from 1 Sep to 30 Sep 2026" style text; '' when no range is set. */
export function rangeText(range: DateRange): string {
  const { from, to } = range;
  if (from && to) {
    const sameYear = from.slice(0, 4) === to.slice(0, 4);
    return `from ${show(from, !sameYear)} to ${show(to, true)}`;
  }
  if (from) return `from ${show(from, true)}`;
  if (to) return `up to ${show(to, true)}`;
  return '';
}
