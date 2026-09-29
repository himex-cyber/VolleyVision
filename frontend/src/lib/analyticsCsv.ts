import { toCsv, type CsvColumn } from './csv';
import type { DateRange, PlayerStatLine, StatLine } from '../types';

/** File-name part for a range: '2026-09-01_today', or 'all-matches' with none. */
export const rangePart = (range?: DateRange) =>
  range?.from || range?.to ? `${range.from ?? 'start'}_${range.to ?? 'today'}` : 'all-matches';

// Numbers stay numbers in a CSV (a "-.125" string would be escaped as text);
// the header carries the unit. Rounded like the on-screen cells.
const round = (value: number | null, places: number) => (value === null ? null : Number(value.toFixed(places)));

const PLAYER_COLUMNS: CsvColumn<PlayerStatLine>[] = [
  { header: 'Player', value: (r) => `${r.player.firstName} ${r.player.lastName}` },
  { header: 'K', value: (r) => r.kills },
  { header: 'E', value: (r) => r.attackErrors },
  { header: 'TA', value: (r) => r.attackAttempts },
  { header: 'Hit % (0–1)', value: (r) => round(r.hittingPercentage, 3) },
  { header: 'Ace', value: (r) => r.aces },
  { header: 'SE', value: (r) => r.serviceErrors },
  { header: 'Pass', value: (r) => round(r.passingRating, 2) },
  { header: 'Blk', value: (r) => round(r.totalBlocks, 1) },
  { header: 'Dig', value: (r) => r.digs },
  { header: 'Ast', value: (r) => r.assists },
];

export const playerStatsCsv = (rows: PlayerStatLine[]) => toCsv(PLAYER_COLUMNS, rows);

/** The same figures StatsCards shows, one stat per row, raw rather than formatted. */
export function teamTotalsCsv(s: StatLine) {
  const rows: [string, number | null][] = [
    ['Kills', s.kills],
    ['Attack errors', s.attackErrors],
    ['Attack attempts', s.attackAttempts],
    ['Hitting % (0–1)', round(s.hittingPercentage, 3)],
    ['Aces', s.aces],
    ['Service errors', s.serviceErrors],
    ['Passing rating', round(s.passingRating, 2)],
    ['Receptions', s.passAttempts],
    ['Total blocks', round(s.totalBlocks, 1)],
    ['Solo blocks', s.soloBlocks],
    ['Block assists', s.blockAssists],
    ['Digs', s.digs],
    ['Dig errors', s.digErrors],
  ];
  return toCsv([{ header: 'Stat', value: (r) => r[0] }, { header: 'Value', value: (r) => r[1] }], rows);
}
