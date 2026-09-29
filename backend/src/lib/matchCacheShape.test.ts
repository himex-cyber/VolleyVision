// 8.0.4: the tracker's offline copy of a match keeps only what the tracker
// and its header read. Entries cached in full by v9.12.0 are trimmed on read.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { trimCachedMatch } from './matchCacheShape';

const full = {
  id: 'M', teamId: 'T', status: 'IN_PROGRESS', matchDate: '2026-09-30T19:00:00.000Z', opponent: 'Hawks',
  competition: 'League', venue: 'Gym', homeScore: 3, awayScore: 2, homeSetsWon: 1, awaySetsWon: 0,
  setScores: [{ set: 1, home: 25, away: 20 }], _count: { events: 12, scoreAdjustments: 1 },
  createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', manualScoreOverride: false,
  team: {
    id: 'T', name: 'Falcons', ownerId: 'owner-user', season: '2026', division: null,
    players: [
      { id: 'p1', firstName: 'Ann', lastName: 'A', jerseyNumber: 1, position: 'SETTER', teamId: 'T', userId: 'ann-user', createdAt: 'x' },
      { id: 'p2', firstName: 'Mere', lastName: 'Tūhoe', jerseyNumber: 2, position: 'LIBERO', teamId: 'T', userId: null },
    ],
  },
};

const trimmed = trimCachedMatch(full);
assert.deepEqual(trimmed, {
  id: 'M', teamId: 'T', status: 'IN_PROGRESS', matchDate: '2026-09-30T19:00:00.000Z', opponent: 'Hawks',
  competition: 'League', venue: 'Gym', homeScore: 3, awayScore: 2, homeSetsWon: 1, awaySetsWon: 0,
  setScores: [{ set: 1, home: 25, away: 20 }], _count: { events: 12, scoreAdjustments: 1 },
  team: {
    id: 'T', name: 'Falcons',
    players: [
      { id: 'p1', firstName: 'Ann', lastName: 'A', jerseyNumber: 1, position: 'SETTER', teamId: 'T' },
      { id: 'p2', firstName: 'Mere', lastName: 'Tūhoe', jerseyNumber: 2, position: 'LIBERO', teamId: 'T' },
    ],
  },
});
assert.ok(!JSON.stringify(trimmed).includes('user'), 'no account ids, no owner');

// Idempotent: trimming a trimmed entry changes nothing (read after write).
assert.deepEqual(trimCachedMatch(trimmed), trimmed);

// Optional fields that were absent stay absent; no team, no team key.
assert.deepEqual(trimCachedMatch({ id: 'M', teamId: 'T', status: 'SCHEDULED', matchDate: 'd', opponent: 'X' }),
  { id: 'M', teamId: 'T', status: 'SCHEDULED', matchDate: 'd', opponent: 'X' });

// The frontend keeps a copy (it has no test runner): from the marker to the
// end it must stay identical to this tested file.
const MARKER = 'const MATCH_KEYS';
const logic = (file: string) => {
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(src.includes(MARKER), `${file} lost its marker`);
  return src.slice(src.indexOf(MARKER));
};
assert.equal(
  logic(path.join(__dirname, '../../../frontend/src/lib/matchCacheShape.ts')),
  logic(path.join(__dirname, 'matchCacheShape.ts')),
  'frontend/src/lib/matchCacheShape.ts has drifted from the tested backend copy',
);

console.log('matchCacheShape tests passed.');
