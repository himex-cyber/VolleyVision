// The report's zone highlight links to the court map, so it must count attacks
// the way the map does (lib/heatmap.ts): tips and free balls are attack
// attempts too. Pure: generateMatchReport touches no database.
import assert from 'node:assert/strict';
import { generateMatchReport, ReportEvent } from '../services/report.service';

const ev = (eventType: string, courtZone: number | null): ReportEvent =>
  ({ eventType, courtZone, setNumber: 1, rotationNumber: 1, playerId: 'p1', recordedAt: new Date(0) });

const report = generateMatchReport(
  { teamName: 'Falcons', opponent: 'Wolves', homeSetsWon: 0, awaySetsWon: 0, setScores: [] },
  [ev('TIP', 4), ev('TIP', 4), ev('FREE_BALL', 4), ev('KILL', 3)],
  [],
);
assert.equal(report.heatMapHighlight, '75% of attacks originated from Zone 4');

console.log('matchReportZones.test.ts passed');
