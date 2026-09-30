// 9.5: a message report's input, and the text kept as evidence.
import assert from 'node:assert/strict';
import { parseReportInput, buildReportDescription, SNAPSHOT_MARKER } from './messageReport';

assert.deepEqual(parseReportInput({ reason: 'harassment' }), { reason: 'harassment', note: null });
assert.deepEqual(parseReportInput({ reason: 'other', note: '  said it twice  ' }), { reason: 'other', note: 'said it twice' });
for (const bad of [{}, { reason: 'rude' }, { reason: 'spam', note: 'x'.repeat(501) }, { reason: 'spam', note: 5 }, null]) {
  assert.ok('error' in parseReportInput(bad), JSON.stringify(bad));
}

const text = buildReportDescription({
  reason: 'harassment', note: null, teamName: 'Falcons', reportedAt: new Date('2026-10-01T09:00:00Z'),
  sentAt: new Date('2026-10-01T08:59:00Z'), body: 'x'.repeat(1200), fileNames: ['photo.jpg'],
});
const [head, snapshot] = text.split(`\n${SNAPSHOT_MARKER}\n`);
assert.match(head, /^Reason: harassment\nNote: —\nTeam: Falcons \(team chat\)\nReported: 2026-10-01T09:00:00.000Z\nSent: 2026-10-01T08:59:00.000Z$/);
assert.equal(snapshot, `${'x'.repeat(1000)}…\nAttachments: photo.jpg`, 'text capped at 1000 characters, then the file names');
assert.equal(buildReportDescription({ reason: 'spam', note: 'n', teamName: 'T', reportedAt: new Date(0), sentAt: new Date(0), body: null, fileNames: [] })
  .split(`\n${SNAPSHOT_MARKER}\n`)[1], '(no text)\nAttachments: none');

console.log('messageReport.test.ts passed');
