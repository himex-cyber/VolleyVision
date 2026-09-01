// The Video lifecycle, as pure rules. No DB, no provider — the completion
// endpoint feeds it a head() result and applies whatever comes back.
//
// The whole point of the state machine is that the API never sees the bytes:
// the browser PUTs straight to the storage provider, so PENDING → READY is only
// ever justified by a server-side head() confirming the object is really there
// and really within the cap. A client claiming "done" proves nothing.

export type VideoStatusName = 'PENDING' | 'READY' | 'FAILED';

/** What provider.head() reports about the object. */
export interface HeadResult {
  exists: boolean;
  sizeBytes: number | null;
  contentType: string | null;
}

/**
 * Legal transitions. PENDING is the only non-terminal state: READY is terminal
 * (bytes are confirmed; nothing later can un-confirm them) and FAILED is
 * terminal too — a retry issues a fresh intent and gets its own row rather than
 * reviving a row whose object may be half-written.
 */
const ALLOWED_TRANSITIONS: Record<VideoStatusName, readonly VideoStatusName[]> = {
  PENDING: ['READY', 'FAILED'],
  READY: [],
  FAILED: [],
};

export function canTransition(from: VideoStatusName, to: VideoStatusName): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Whether a fresh upload credential may be issued for an existing row.
 *
 * Only while PENDING. Re-crediting a READY row would let a new upload overwrite
 * footage already confirmed and possibly already tagged with timestamps; a
 * FAILED row is terminal and retries start a new intent.
 */
export function canRefreshUpload(status: VideoStatusName): boolean {
  return status === 'PENDING';
}

export type CompletionOutcome =
  | { status: 'READY'; sizeBytes: number | null; contentType: string | null }
  | { status: 'FAILED'; reason: 'missing' | 'oversize' };

/**
 * Decide a PENDING row's fate from the provider's own view of the object.
 *
 * - object absent  → FAILED/missing  (client never finished, or the URL expired)
 * - real size over the cap → FAILED/oversize (the size declared at intent was a
 *   claim; this is the measurement, and it is the one that counts)
 * - otherwise → READY, carrying the provider's real size and type
 *
 * A null size means the provider could not report one; that is not grounds to
 * fail an object it confirms exists, so it passes and the column stays null.
 */
export function resolveUploadCompletion(head: HeadResult, maxSizeBytes: number): CompletionOutcome {
  if (!head.exists) return { status: 'FAILED', reason: 'missing' };
  if (head.sizeBytes !== null && head.sizeBytes > maxSizeBytes) {
    return { status: 'FAILED', reason: 'oversize' };
  }
  return { status: 'READY', sizeBytes: head.sizeBytes, contentType: head.contentType };
}
