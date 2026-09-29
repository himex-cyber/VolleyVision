// The offline event queue's pure core (6.6). Tested here; the frontend keeps
// an identical copy from the marker line down (eventQueueCore.test.ts fails if
// it drifts), and adds storage and the network around it.
//
// A tracker's taps go into this queue first, online or offline, and are sent
// in order. Nothing here is ever dropped silently: an item leaves the queue
// only when the server has it (created/duplicate), a delete has landed, or the
// user discards a rejected tap.

import { scoringTeam } from './scoringRules';
import { replayTimeline } from './scoreReplay';
import type { ReplayResult, ReplayStart } from './scoreReplay';

export interface QueuedEventPayload {
  playerId?: string;
  eventType: string;
  setNumber: number;
  courtZone?: number | null;
  rotationNumber?: number | null;
  isOpponentEvent?: boolean;
  opponentJerseyNumber?: number | null;
  /** Who served the rally (7.2), as set on the tracker when tapped. */
  servingSide?: 'US' | 'THEM' | null;
}

export interface QueueItem {
  clientKey: string;
  op: 'create' | 'delete';
  matchId: string;
  payload?: QueuedEventPayload;
  recordedAt: string;
  /** A delete's target. */
  serverId?: string;
  state: 'queued' | 'sending' | 'rejected';
  error?: string;
  attempts: number;
  /** Undone after it was sent: delete it once the server confirms it. */
  undoRequested?: boolean;
}

export type BatchStatus = 'created' | 'duplicate' | 'rejected' | 'retry';
export interface BatchOutcome { clientKey: string; status: BatchStatus; serverId?: string; error?: string }

/** Beyond this, recording is blocked rather than risking lost taps. */
export const MAX_QUEUE = 2000;
/** Must match MAX_EVENT_BATCH in backend/src/controllers/events.ts. */
export const MAX_BATCH = 20;

const isCreate = (i: QueueItem) => i.op === 'create';

/** Adds a tap. Null when the queue is full. */
export function enqueueCreate(
  items: QueueItem[],
  tap: { clientKey: string; matchId: string; payload: QueuedEventPayload; recordedAt: string },
): QueueItem[] | null {
  if (items.length >= MAX_QUEUE) return null;
  return [...items, { ...tap, op: 'create', state: 'queued', attempts: 0 }];
}

export function enqueueDelete(
  items: QueueItem[],
  del: { clientKey: string; matchId: string; serverId: string; recordedAt: string },
): QueueItem[] {
  return [...items, { ...del, op: 'delete', state: 'queued', attempts: 0 }];
}

/**
 * On load, after a network error or a failed request: anything marked
 * sending goes back to queued. Its attempts stay counted, so undo still knows
 * it may have reached the server.
 */
export function resetSending(items: QueueItem[]): QueueItem[] {
  return items.map((i) => (i.state === 'sending' ? { ...i, state: 'queued' } : i));
}

/**
 * What to send next: the first queued item and, for a create, the queued
 * creates straight after it (up to MAX_BATCH). Rejected items are skipped;
 * they wait for the user.
 */
export function nextSend(
  items: QueueItem[],
): { op: 'create'; items: QueueItem[] } | { op: 'delete'; item: QueueItem } | null {
  const start = items.findIndex((i) => i.state === 'queued');
  if (start === -1) return null;
  const first = items[start];
  if (!isCreate(first)) return { op: 'delete', item: first };
  const batch: QueueItem[] = [];
  for (const i of items.slice(start)) {
    if (i.state === 'rejected') continue;
    if (i.state !== 'queued' || !isCreate(i) || batch.length === MAX_BATCH) break;
    batch.push(i);
  }
  return { op: 'create', items: batch };
}

export function markSending(items: QueueItem[], keys: string[]): QueueItem[] {
  const set = new Set(keys);
  return items.map((i) => (set.has(i.clientKey) ? { ...i, state: 'sending', attempts: i.attempts + 1 } : i));
}

/**
 * Applies a batch response. A created/duplicate item leaves the queue; if it
 * was undone meanwhile, a delete for it takes its place. `synced` lists this
 * device's taps now on the server, for undo's session history.
 */
export function applyBatchResults(
  items: QueueItem[],
  results: BatchOutcome[],
  newKey: () => string,
): { items: QueueItem[]; synced: { clientKey: string; serverId: string }[] } {
  const byKey = new Map(results.map((r) => [r.clientKey, r]));
  const synced: { clientKey: string; serverId: string }[] = [];
  const out: QueueItem[] = [];
  for (const i of items) {
    // Any live item the server answered for: another tab's reload may have
    // put an in-flight item back to queued meanwhile.
    const r = i.state !== 'rejected' ? byKey.get(i.clientKey) : undefined;
    if (!r) {
      out.push(i.state === 'sending' ? { ...i, state: 'queued' } : i);
      continue;
    }
    if ((r.status === 'created' || r.status === 'duplicate') && r.serverId) {
      if (i.undoRequested) {
        out.push({ clientKey: newKey(), op: 'delete', matchId: i.matchId, serverId: r.serverId, recordedAt: i.recordedAt, state: 'queued', attempts: 0 });
      } else {
        synced.push({ clientKey: i.clientKey, serverId: r.serverId });
      }
    } else if (r.status === 'rejected') {
      // An undone tap the server refused needs nothing more.
      if (!i.undoRequested) out.push({ ...i, state: 'rejected', error: r.error ?? "The server didn't accept this." });
    } else {
      out.push({ ...i, state: 'queued' });
    }
  }
  return { items: out, synced };
}

/**
 * A whole request refused (a 4xx other than 401/429): those items wait for the
 * user. An undone tap in it needs nothing more, as in applyBatchResults.
 */
export function rejectItems(items: QueueItem[], keys: string[], error: string): QueueItem[] {
  const set = new Set(keys);
  return items
    .filter((i) => !(set.has(i.clientKey) && i.undoRequested))
    .map((i) => (set.has(i.clientKey) ? { ...i, state: 'rejected', error } : i));
}

export type FailureKind = 'network' | 'auth' | 'rate' | 'retry' | 'server' | 'reject';

/**
 * What a failed send means (6.6). No response (offline, timeout): keep and
 * retry later. 401: keep; the user signs in again. 429: back off. A 409
 * marked retryable: retry. 5xx: keep. Any other 4xx: the server refused it,
 * so it waits for the user (never dropped silently).
 */
export function failureKind(status: number | null, retryable: boolean): FailureKind {
  if (status == null) return 'network';
  if (status === 401) return 'auth';
  if (status === 429) return 'rate';
  if (status === 409 && retryable) return 'retry';
  if (status >= 500) return 'server';
  return 'reject';
}

/** A delete landed (or its event was already gone): drop it. */
export function removeItem(items: QueueItem[], clientKey: string): QueueItem[] {
  return items.filter((i) => i.clientKey !== clientKey);
}

export function retryItem(items: QueueItem[], clientKey: string): QueueItem[] {
  return items.map((i) => (i.clientKey === clientKey && i.state === 'rejected' ? { ...i, state: 'queued', error: undefined } : i));
}

/**
 * Undo the newest tap still in the queue. Never sent (no attempts, not in
 * flight): just remove it. Sent but not confirmed: it may already be on the
 * server with its response lost, so dropping it would leave an event the user
 * thinks they undid; mark it, and applyBatchResults queues its delete.
 * 'none' means the caller undoes from the session history, or online.
 */
export function undoNewest(items: QueueItem[]): { items: QueueItem[]; result: 'removed' | 'undo-requested' | 'none' } {
  for (let n = items.length - 1; n >= 0; n--) {
    const i = items[n];
    if (!isCreate(i) || i.undoRequested || i.state === 'rejected') continue;
    if (i.attempts === 0 && i.state === 'queued') return { items: items.filter((_, k) => k !== n), result: 'removed' };
    return { items: items.map((x, k) => (k === n ? { ...x, undoRequested: true } : x)), result: 'undo-requested' };
  }
  return { items, result: 'none' };
}

export function queueSummary(items: QueueItem[]): { waiting: number; rejected: number } {
  const rejected = items.filter((i) => i.state === 'rejected').length;
  return { waiting: items.length - rejected, rejected };
}

type ServerEvent = { id: string; clientKey?: string | null; eventType: string; isOpponentEvent: boolean };

/**
 * The score to show while taps are queued: the server's state, minus points it
 * already has that are being undone, plus queued taps it doesn't have yet (an
 * item the server applied while still marked sending would otherwise count
 * twice). Provisional until the server confirms.
 */
export function provisionalScore(
  server: ReplayStart,
  serverEvents: ServerEvent[],
  items: QueueItem[],
): ReplayResult & { provisional: boolean } {
  const keys = new Set(serverEvents.map((e) => e.clientKey).filter(Boolean));
  const byId = new Map(serverEvents.map((e) => [e.id, e]));
  const live = items.filter((i) => i.state !== 'rejected');

  // ponytail: a removal only lowers the running score (floor 0); it never
  // re-opens a set the server already closed. The server's replay settles it.
  let { homeScore, awayScore } = server;
  const removing = [
    ...live.filter((i) => !isCreate(i)).map((i) => byId.get(i.serverId ?? '')),
    ...live.filter((i) => isCreate(i) && i.undoRequested && keys.has(i.clientKey)).map((i) => ({ eventType: i.payload!.eventType, isOpponentEvent: !!i.payload!.isOpponentEvent })),
  ];
  for (const e of removing) {
    const side = e ? scoringTeam(e.eventType, e.isOpponentEvent) : null;
    if (side === 'home') homeScore = Math.max(0, homeScore - 1);
    if (side === 'away') awayScore = Math.max(0, awayScore - 1);
  }

  const adding = live
    .filter((i) => isCreate(i) && !i.undoRequested && !keys.has(i.clientKey))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    .map((i) => ({ kind: 'event' as const, eventType: i.payload!.eventType, isOpponentEvent: !!i.payload!.isOpponentEvent, at: new Date(i.recordedAt) }));

  const result = replayTimeline(adding, { ...server, homeScore, awayScore });
  return { ...result, provisional: live.length > 0 };
}
