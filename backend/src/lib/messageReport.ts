// Message reports (9.5) carry a snapshot of the reported message, so the
// evidence outlives its removal. The description is the report's own lines,
// then this marker line, then the snapshot. Account deletion (9.4) replaces
// everything after the marker when the reported message's author leaves.
export const SNAPSHOT_MARKER = '--- Snapshot ---';
export const REMOVED_SNAPSHOT = '[removed: account deleted]';
