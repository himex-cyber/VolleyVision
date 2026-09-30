// Message reports (9.5) carry a snapshot of the reported message, so the
// evidence outlives its removal. The description is the report's own lines,
// then this marker line, then the snapshot. Account deletion (9.4) replaces
// everything after the marker when the reported message's author leaves.
export const SNAPSHOT_MARKER = '--- Snapshot ---';
export const REMOVED_SNAPSHOT = '[removed: account deleted]';

export const REPORT_REASONS = ['harassment', 'inappropriate', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
const MAX_NOTE = 500;
const MAX_SNAPSHOT = 1000;

export function parseReportInput(raw: unknown): { reason: ReportReason; note: string | null } | { error: string } {
  const { reason, note } = (raw ?? {}) as Record<string, unknown>;
  if (!REPORT_REASONS.includes(reason as ReportReason)) return { error: 'Pick a reason for the report.' };
  if (note != null && typeof note !== 'string') return { error: 'The note must be text.' };
  const trimmed = typeof note === 'string' ? note.trim() : '';
  if (trimmed.length > MAX_NOTE) return { error: `Keep the note under ${MAX_NOTE} characters.` };
  return { reason: reason as ReportReason, note: trimmed || null };
}

/** The report's text: its own lines, the marker, then the snapshot (9.4 blanks everything after the marker). */
export function buildReportDescription(r: {
  reason: ReportReason; note: string | null; teamName: string; reportedAt: Date; sentAt: Date;
  body: string | null; fileNames: string[];
}): string {
  const body = r.body == null ? '(no text)' : r.body.length > MAX_SNAPSHOT ? `${r.body.slice(0, MAX_SNAPSHOT)}…` : r.body;
  return [
    `Reason: ${r.reason}`,
    `Note: ${r.note ?? '—'}`,
    `Team: ${r.teamName} (team chat)`,
    `Reported: ${r.reportedAt.toISOString()}`,
    `Sent: ${r.sentAt.toISOString()}`,
    SNAPSHOT_MARKER,
    body,
    `Attachments: ${r.fileNames.length ? r.fileNames.join(', ') : 'none'}`,
  ].join('\n');
}
