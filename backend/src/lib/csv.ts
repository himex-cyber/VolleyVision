// CSV for the dashboards' Download CSV buttons (8.5). Consumed by the SPA
// (frontend/src/lib/csv.ts carries a copy with the download helpers); it lives
// here because this is where the repo can run a test.
//
// RFC 4180 (quote a field holding , " CR or LF; double its quotes; CRLF rows),
// a UTF-8 BOM first so Excel reads macrons and accents, and formula-injection
// escaping on text cells. Pass numbers as numbers and put the unit in the
// header: a formatted "-12.5%" string would be escaped into text.

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
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
