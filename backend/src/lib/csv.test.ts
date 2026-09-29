// 8.5: CSV the dashboards export. RFC 4180 quoting, formula-injection
// escaping on text cells only (player names are free text), numbers left as
// numbers, a BOM so Excel reads macrons, CRLF rows.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { toCsv } from './csv';

const BOM = '﻿';
type Row = { name: string | null; n: number | null };
const cols = [
  { header: 'Player', value: (r: Row) => r.name },
  { header: 'Hit % (0–1)', value: (r: Row) => r.n },
];
const one = (row: Row) => toCsv(cols, [row]).slice(BOM.length).split('\r\n')[1];

// BOM, header row, CRLF after every row (the last included).
assert.equal(toCsv(cols, [{ name: 'Ann', n: 0.25 }]), `${BOM}Player,Hit % (0–1)\r\nAnn,0.25\r\n`);
assert.equal(toCsv(cols, []), `${BOM}Player,Hit % (0–1)\r\n`, 'no rows: just the header');

// Quoting: comma, quote, CR, LF; quotes doubled.
assert.equal(one({ name: 'Smith, Jo', n: 1 }), '"Smith, Jo",1');
assert.equal(one({ name: 'Jo "Spike" Smith', n: 1 }), '"Jo ""Spike"" Smith",1');
assert.equal(toCsv(cols, [{ name: 'two\nlines', n: 1 }]).slice(BOM.length).split('\r\n')[1], '"two\nlines",1');
assert.equal(one({ name: 'cr\rhere', n: 1 }), '"cr\rhere",1');

// Formula injection: every dangerous first character gets a leading '.
for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
  const cell = one({ name: `${lead}1+1`, n: 1 }).split(',')[0];
  assert.ok(cell.replace(/^"/, '').startsWith(`'${lead}`), `${JSON.stringify(lead)} -> ${JSON.stringify(cell)}`);
}
assert.equal(one({ name: '=HYPERLINK("http://x","y")', n: 1 }), `"'=HYPERLINK(""http://x"",""y"")",1`);
assert.equal(one({ name: '-2+3', n: 1 }), "'-2+3,1");
assert.equal(one({ name: 'A=B', n: 1 }), 'A=B,1', 'only the first character matters');

// Numbers stay numbers, negative ones too; never prefixed.
assert.equal(one({ name: 'Ann', n: -0.125 }), 'Ann,-0.125');
assert.equal(one({ name: 'Ann', n: 0 }), 'Ann,0');
assert.equal(one({ name: 'Ann', n: NaN }), 'Ann,', 'NaN is an empty cell, not "NaN"');

// null is an empty field.
assert.equal(one({ name: null, n: null }), ',');

// Macrons and accents pass through (the BOM makes Excel read them as UTF-8).
assert.equal(one({ name: 'Mere Tūhoe', n: 3 }), 'Mere Tūhoe,3');

// Headers go through the same escaping.
assert.equal(toCsv([{ header: '=cmd', value: () => 1 }], []), `${BOM}'=cmd\r\n`);

// The frontend keeps a copy (it has no test runner): from the marker to the
// end it must stay identical to this tested file.
const MARKER = 'export function toCsv';
const logic = (file: string) => {
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(src.includes(MARKER), `${file} lost its marker`);
  return src.slice(src.indexOf(MARKER));
};
assert.equal(
  logic(path.join(__dirname, '../../../frontend/src/lib/csv.ts')),
  logic(path.join(__dirname, 'csv.ts')),
  'frontend/src/lib/csv.ts has drifted from the tested backend copy',
);

console.log('csv tests passed.');
