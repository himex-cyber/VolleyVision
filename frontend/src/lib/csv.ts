/**
 * CSV download for the dashboards (8.5, web only: the Android WebView does
 * nothing with a blob: download). toCsv and below are a copy of
 * backend/src/lib/csv.ts, tested there (csv.test.ts fails if this drifts from
 * the toCsv line down). The export uses only data the page already has, so it
 * inherits the per-player rule: staff get every row, a player their own.
 */

/** Saves `text` as a .csv file through a temporary <a download>. */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked a tick later: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** e.g. ['VolleyVision', 'Wolves', 'player stats', '2026-09-01_2026-09-30'] -> volleyvision-wolves-player-stats-2026-09-01_2026-09-30.csv */
export function safeFileName(parts: (string | null | undefined)[]): string {
  const slug = parts
    .filter((p): p is string => !!p)
    .join('-')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Tūhoe -> Tuhoe
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return `${slug || 'volleyvision'}.csv`;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const line = (cells: CsvCell[]) => cells.map(field).join(',') + '\r\n';
  return '\uFEFF' + line(columns.map((c) => c.header)) + rows.map((r) => line(columns.map((c) => c.value(r)))).join('');
}

export type CsvCell = string | number | null;
export type CsvColumn<T> = { header: string; value: (row: T) => CsvCell };

// A text cell starting with one of these is read as a formula by Excel and
// Sheets (=HYPERLINK(...) in a player's name would run). Numbers are never
// prefixed: a hitting % of -0.125 must stay a number.
const FORMULA_START = /^[=+\-@\t\r]/;

function field(cell: CsvCell): string {
  if (cell === null) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  const text = FORMULA_START.test(cell) ? `'${cell}` : cell;
  // `;` too: Excel in a locale that separates on semicolons would split
  // 'Smith;=cmd' and start a cell with '='. A quoted field is one cell.
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
