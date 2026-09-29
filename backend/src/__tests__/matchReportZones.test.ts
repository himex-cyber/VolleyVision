// The report's zone highlight links to the court map, so it must count attacks
// the way the map does (lib/heatmap.ts): tips and free balls are attack
// attempts too. Pure: generateMatchReport touches no database.
import assert from 'node:assert/strict';
import { generateMatchReport, ReportEvent, ReportPointEvent } from '../services/report.service';

const ev = (eventType: string, courtZone: number | null): ReportEvent =>
  ({ eventType, courtZone, setNumber: 1, rotationNumber: 1, playerId: 'p1', recordedAt: new Date(0) });

const report = generateMatchReport(
  { teamName: 'Falcons', opponent: 'Wolves', homeSetsWon: 0, awaySetsWon: 0, setScores: [] },
  [ev('TIP', 4), ev('TIP', 4), ev('FREE_BALL', 4), ev('KILL', 3)],
  [],
  [],
);
assert.equal(report.heatMapHighlight, '75% of attacks originated from Zone 4');

// 7.10: momentum and best rotation read the opponent-inclusive list; attack
// stats keep ours only.
const pe = (eventType: string, isOpponentEvent: boolean, s: number, rotationNumber = 2): ReportPointEvent =>
  ({ eventType, isOpponentEvent, setNumber: 1, rotationNumber, servingSide: null, recordedAt: new Date(s * 1000) });
const withOpp = generateMatchReport(
  { teamName: 'Falcons', opponent: 'Wolves', homeSetsWon: 0, awaySetsWon: 0, setScores: [] },
  [ev('KILL', 3)],
  [],
  [pe('KILL', false, 1), pe('KILL', true, 2), pe('KILL', true, 3), pe('KILL', true, 4)],
);
assert.equal(withOpp.attack.kills, 1, "an opponent's kill is not ours");
assert.deepEqual(withOpp.momentum, { longestRun: 3, longestRunTeam: 'Wolves', leadChanges: 1, largestHomeLead: 1, largestAwayLead: 2 });
// Same shape installed apps read: efficiency (= point win %) and total.
assert.deepEqual(withOpp.bestRotation, { rotation: 2, won: 1, lost: 3, total: 4, net: -2, efficiency: 25 });

console.log('matchReportZones.test.ts passed');
