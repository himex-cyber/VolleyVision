// The offline event queue (6.6): every tap is stored on the device first,
// online or offline, then sent in order through POST /events/batch. The pure
// rules live in eventQueueCore.ts (tested in the backend); this file adds
// storage, one flush at a time, and what each server answer means.
//
// Keyed by user and match (vv_queue:<userId>:<matchId>), so one account never
// sends another's taps. A 401 keeps the queue: the interceptor sends the user
// to sign in, and the queue flushes when that same user is back.
import * as Sentry from '@sentry/react';
import axios from 'axios';
import { eventsApi, getApiErrorMessage, onApiResponse } from './api';
import {
  applyBatchResults, enqueueCreate, enqueueDelete, failureKind, markSending, nextSend, rejectItems,
  removeItem, resetSending, retryItem, undoNewest,
} from './eventQueueCore';
import type { FailureKind, QueueItem, QueuedEventPayload } from './eventQueueCore';
import { storageGet, storageKeys, storageRemove, storageSet, storageWorks, storageDurable } from './safeStorage';
import { getToken } from './tokenStorage';

const QUEUE_PREFIX = 'vv_queue:';
export const DEVICE_KEYS_PREFIX = 'vv_keys:';
const qKey = (userId: string, matchId: string) => `${QUEUE_PREFIX}${userId}:${matchId}`;
// The API sends no Retry-After, so a 429 waits a flat 30 s.
const RATE_LIMIT_BACKOFF_MS = 30_000;
// An outdated app gets the same 426 until it's updated; the page it's on says so.
const OUTDATED_BACKOFF_MS = 10 * 60_000;
// This device's own keys per match, for the two-device warning (6.11), kept
// for the few most recent matches only.
const MAX_DEVICE_KEYS = 3000;
const MAX_DEVICE_KEY_MATCHES = 10;

/** crypto.randomUUID needs a secure context (and iOS 15.4+); a LAN test over http has neither. */
export function newKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// ─── Store ───────────────────────────────────────────────────────────────────
// Storage is the source of truth, re-read on every access so two tabs (or a
// write during a flush) never overwrite each other with a stale copy. The
// parsed copy is cached per raw string, which also gives React a stable
// snapshot. A key whose write ever failed (storage blocked or full) lives in
// `memory` from then on, for this tab, so a tap is never silently lost.
// ponytail: enqueue/undo/discard don't take the flush lock, so two tabs
// tracking the same match at the same instant can race a write. Take the lock
// for writes if that ever matters.

const memory = new Map<string, QueueItem[]>();
const parsed = new Map<string, { raw: string; items: QueueItem[] }>();
const resetOnLoad = new Set<string>();
const EMPTY: QueueItem[] = [];
let persistFailed = false;

function read(userId: string, matchId: string): QueueItem[] {
  const k = qKey(userId, matchId);
  const mem = memory.get(k);
  if (mem || !storageWorks()) return mem ?? EMPTY;
  const raw = storageGet(k);
  if (!raw) return EMPTY;
  const hit = parsed.get(k);
  if (hit?.raw === raw) return hit.items;
  let items: QueueItem[] = [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) items = v;
  } catch { /* unreadable: treat as empty rather than crash the tracker */ }
  // A tap left 'sending' by a killed app goes back in line, once per load.
  if (!resetOnLoad.has(k)) {
    resetOnLoad.add(k);
    items = resetSending(items);
    if (!storageSet(k, JSON.stringify(items))) {
      memory.set(k, items);
      persistFailed = true;
      return items;
    }
    return read(userId, matchId);
  }
  parsed.set(k, { raw, items });
  return items;
}

function write(userId: string, matchId: string, items: QueueItem[]): void {
  const k = qKey(userId, matchId);
  if (memory.has(k) || !storageWorks()) {
    memory.set(k, items);
  } else if (items.length) {
    if (!storageSet(k, JSON.stringify(items))) {
      memory.set(k, items);
      persistFailed = true;
    }
  } else {
    storageRemove(k);
  }
  emit();
}

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith(QUEUE_PREFIX)) listener(); };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function getQueue(userId: string, matchId: string): QueueItem[] {
  return read(userId, matchId);
}

/** False when this device can't keep taps across a restart (blocked or full storage). */
export function queueCanPersist(): boolean {
  return storageWorks() && storageDurable() && !persistFailed;
}

/** Matches with anything still queued for this user. */
function queuedMatchIds(userId: string): string[] {
  const prefix = `${QUEUE_PREFIX}${userId}:`;
  const keys = new Set([
    ...storageKeys(prefix),
    ...[...memory.keys()].filter((k) => k.startsWith(prefix) && memory.get(k)!.length),
  ]);
  return [...keys].map((k) => k.slice(prefix.length));
}

export function hasQueued(userId: string): boolean {
  return queuedMatchIds(userId).length > 0;
}

// ─── Connectivity ────────────────────────────────────────────────────────────
// navigator.onLine misses a gym wifi with no internet, so the last request's
// fate counts too. Any answer from the API, or the browser saying it's back
// online, clears it.

let lastRequestFailed = false;
export function isOffline(): boolean {
  return !navigator.onLine || lastRequestFailed;
}
function setReachable(ok: boolean) {
  if (lastRequestFailed === ok) {
    lastRequestFailed = !ok;
    emit();
  }
}
window.addEventListener('online', () => { lastRequestFailed = false; emit(); });
window.addEventListener('offline', emit);
onApiResponse(() => setReachable(true));

// ─── This device's keys (6.11) ───────────────────────────────────────────────

const deviceKeysKey = (userId: string, matchId: string) => `${DEVICE_KEYS_PREFIX}${userId}:${matchId}`;
const deviceKeysMemory = new Map<string, string[]>();
// Parsed once per stored value: the tracker asks on every render, and late in
// a match the list is thousands of keys.
const deviceKeysParsed = new Map<string, { raw: string; keys: Set<string> }>();

export function deviceKeys(userId: string, matchId: string): Set<string> {
  const k = deviceKeysKey(userId, matchId);
  const mem = deviceKeysMemory.get(k);
  if (mem || !storageWorks()) return new Set(mem ?? []);
  const raw = storageGet(k) ?? '[]';
  const hit = deviceKeysParsed.get(k);
  if (hit?.raw === raw) return hit.keys;
  let keys = new Set<string>();
  try { keys = new Set(JSON.parse(raw)); } catch { /* unreadable: no keys */ }
  deviceKeysParsed.set(k, { raw, keys });
  return keys;
}

function rememberDeviceKey(userId: string, matchId: string, clientKey: string) {
  const k = deviceKeysKey(userId, matchId);
  const others = storageKeys(DEVICE_KEYS_PREFIX).filter((x) => x !== k);
  for (const x of others.slice(0, Math.max(0, others.length - (MAX_DEVICE_KEY_MATCHES - 1)))) storageRemove(x);
  const keys = [...deviceKeys(userId, matchId), clientKey].slice(-MAX_DEVICE_KEYS);
  if (deviceKeysMemory.has(k) || !storageWorks() || !storageSet(k, JSON.stringify(keys))) deviceKeysMemory.set(k, keys);
}

// ─── Undo's session history ──────────────────────────────────────────────────
// This user's taps that reached the server this session, newest last, so Undo
// can take back its own last tap by id. Manual score changes clear it (undo
// must then reach the adjustment first, which only the server's undo-last
// knows about); so does signing out.

const history = new Map<string, string[]>();
const hKey = (userId: string, matchId: string) => `${userId}:${matchId}`;

export function clearUndoHistory(matchId: string): void {
  for (const k of [...history.keys()]) if (k.endsWith(`:${matchId}`)) history.delete(k);
  emit();
}

/** Sign-out: nothing of one account's history may reach the next. */
export function forgetSession(): void {
  history.clear();
  deviceKeysMemory.clear();
  emit();
}

/**
 * Account deletion (9.4): this account's queued taps and device keys go, from
 * storage and memory. Other accounts on a shared device keep theirs.
 */
export function purgeUserQueue(userId: string): void {
  const prefixes = [`${QUEUE_PREFIX}${userId}:`, `${DEVICE_KEYS_PREFIX}${userId}:`];
  for (const prefix of prefixes) {
    for (const k of storageKeys(prefix)) storageRemove(k);
    for (const map of [memory, parsed, deviceKeysMemory, deviceKeysParsed]) {
      for (const k of [...map.keys()]) if (k.startsWith(prefix)) map.delete(k);
    }
  }
  forgetSession();
}

/** Whether Undo can work without a connection: a tap of ours to take back. */
export function hasLocalUndo(userId: string, matchId: string): boolean {
  return undoNewest(read(userId, matchId)).result !== 'none' || (history.get(hKey(userId, matchId))?.length ?? 0) > 0;
}

// ─── Enqueue and undo ────────────────────────────────────────────────────────

export class QueueFullError extends Error {}

/** Stores a tap and starts sending. Throws QueueFullError at the cap. */
export function enqueueTap(userId: string, matchId: string, payload: QueuedEventPayload): string {
  const clientKey = newKey();
  const next = enqueueCreate(read(userId, matchId), { clientKey, matchId, payload, recordedAt: new Date().toISOString() });
  if (!next) throw new QueueFullError();
  rememberDeviceKey(userId, matchId, clientKey);
  write(userId, matchId, next);
  scheduleFlush(userId, matchId);
  return clientKey;
}

// A tap waits a moment before sending, so a burst of taps (a rally) goes as
// one batch rather than one request each. The board shows it at once anyway.
const FLUSH_DELAY_MS = 800;
const pendingFlush = new Map<string, number>();
function scheduleFlush(userId: string, matchId: string) {
  window.clearTimeout(pendingFlush.get(matchId));
  pendingFlush.set(matchId, window.setTimeout(() => {
    pendingFlush.delete(matchId);
    void flushMatch(userId, matchId);
  }, FLUSH_DELAY_MS));
}

/**
 * Undo this device's last tap, in the queue: a queued tap (its payload) or one
 * that reached the server this session (its server id). null = nothing of
 * ours to undo, so the caller falls back to the server's undo-last, which
 * needs a connection.
 */
export function undoTap(userId: string, matchId: string): { payload?: QueuedEventPayload; serverId?: string } | null {
  const { items, result, undone } = undoNewest(read(userId, matchId));
  if (result !== 'none') {
    write(userId, matchId, items);
    return { payload: undone?.payload };
  }
  const serverId = history.get(hKey(userId, matchId))?.pop();
  if (!serverId) return null;
  queueDelete(userId, matchId, serverId);
  return { serverId };
}

function queueDelete(userId: string, matchId: string, serverId: string): void {
  write(userId, matchId, enqueueDelete(read(userId, matchId), {
    clientKey: newKey(), matchId, serverId, recordedAt: new Date().toISOString(),
  }));
  void flushMatch(userId, matchId);
}

export function retryTap(userId: string, matchId: string, clientKey: string): void {
  write(userId, matchId, retryItem(read(userId, matchId), clientKey));
  void flushMatch(userId, matchId);
}

export function discardTap(userId: string, matchId: string, clientKey: string): void {
  write(userId, matchId, removeItem(read(userId, matchId), clientKey));
}

/** Every refused item on this match (after the user confirmed). */
export function discardRejected(userId: string, matchId: string): void {
  write(userId, matchId, read(userId, matchId).filter((i) => i.state !== 'rejected'));
}

// ─── Flushing ────────────────────────────────────────────────────────────────

let backoffUntil = 0;
let onSynced: ((matchId: string) => Promise<unknown>) | null = null;
/**
 * The root flusher registers this to refetch the match's score and events.
 * It's awaited before synced taps leave the queue: until the refetch lands,
 * the board is the old server score plus the queue, and dropping the taps
 * first would show the score going backwards.
 */
export function setOnSynced(fn: ((matchId: string) => Promise<unknown>) | null): void {
  onSynced = fn;
}

// Consecutive 5xx answers per match, this session only. A batch that keeps
// failing is resent forever and stalls the queue behind it, so past the limit
// the tracker says so (SyncBadge) and we tell Sentry once.
export const STUCK_AFTER = 5;
const serverFailures = new Map<string, number>();
const reportedStuck = new Set<string>();

export function serverFailureCount(matchId: string): number {
  return serverFailures.get(matchId) ?? 0;
}

function noteSynced(matchId: string) {
  if (serverFailures.delete(matchId)) emit();
}

function classify(err: unknown): { kind: FailureKind; message: string; status: number | null } {
  const res = axios.isAxiosError(err) ? err.response : undefined;
  const retryable = !!(res?.data as { retryable?: boolean } | undefined)?.retryable;
  return {
    status: res ? res.status : null,
    kind: failureKind(res ? res.status : null, retryable),
    message: getApiErrorMessage(err, "The server didn't accept this."),
  };
}

/** True when the loop should stop (items kept; a later trigger retries). */
function handleFailure(userId: string, matchId: string, keys: string[], failure: { kind: FailureKind; message: string; status: number | null }): boolean {
  const items = read(userId, matchId);
  if (failure.kind === 'reject') {
    write(userId, matchId, rejectItems(resetSending(items), keys, failure.message));
    return false;
  }
  write(userId, matchId, resetSending(items));
  if (failure.kind === 'server') {
    const count = serverFailureCount(matchId) + 1;
    serverFailures.set(matchId, count);
    // Ids, the count and the status only: never a tap's payload or a player.
    if (count >= STUCK_AFTER && !reportedStuck.has(matchId)) {
      reportedStuck.add(matchId);
      Sentry.captureMessage('Offline queue stuck on server errors', {
        level: 'warning',
        tags: { matchId, status: String(failure.status) },
        extra: { matchId, failures: count, status: failure.status },
      });
    }
    emit();
  }
  if (failure.kind === 'network') setReachable(false);
  if (failure.kind === 'rate') backoffUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
  if (failure.kind === 'outdated') backoffUntil = Date.now() + OUTDATED_BACKOFF_MS;
  return true;
}

function toBody(i: QueueItem) {
  return { ...i.payload, matchId: i.matchId, clientKey: i.clientKey, recordedAt: i.recordedAt };
}

async function flushLoop(userId: string, matchId: string): Promise<void> {
  // A different account signing in mid-flush: stop, so this user's taps never
  // go out with the next user's token.
  const token = getToken();
  // Bounded: a queue can't make one flush spin forever.
  for (let round = 0; round < 200; round++) {
    if (Date.now() < backoffUntil || getToken() !== token || !token) return;
    // Airplane mode: don't even try. A tap never sent can't be on the
    // server, so Undo can simply remove it (an attempted one has to wait
    // for the server's answer). The 'online' event flushes again.
    if (!navigator.onLine) return;
    const next = nextSend(read(userId, matchId));
    if (!next) return;

    if (next.op === 'create') {
      const keys = next.items.map((i) => i.clientKey);
      write(userId, matchId, markSending(read(userId, matchId), keys));
      let results;
      try {
        results = await eventsApi.batch(matchId, next.items.map(toBody));
      } catch (err) {
        if (handleFailure(userId, matchId, keys, classify(err))) return;
        continue;
      }
      noteSynced(matchId);
      await onSynced?.(matchId);
      const applied = applyBatchResults(
        read(userId, matchId),
        results.map((r) => ({ clientKey: r.clientKey, status: r.status, serverId: r.event?.id, error: r.error })),
        newKey,
      );
      write(userId, matchId, applied.items);
      const h = history.get(hKey(userId, matchId)) ?? [];
      history.set(hKey(userId, matchId), [...h, ...applied.synced.map((s) => s.serverId)]);
      // A conflict with another device: leave it for the next trigger
      // rather than hammer the server.
      if (results.some((r) => r.status === 'retry')) return;
    } else {
      const { clientKey, serverId } = next.item;
      write(userId, matchId, markSending(read(userId, matchId), [clientKey]));
      try {
        await eventsApi.delete(serverId!);
      } catch (err) {
        // Already gone ("Resource not found." on a repeat): that's done too.
        const gone = axios.isAxiosError(err) && err.response?.status === 404;
        if (!gone) {
          if (handleFailure(userId, matchId, [clientKey], classify(err))) return;
          continue;
        }
      }
      noteSynced(matchId);
      await onSynced?.(matchId);
      write(userId, matchId, removeItem(read(userId, matchId), clientKey));
    }
  }
}

// One flush per match at a time, across tabs where the browser has Web Locks;
// otherwise within this tab. A flush that has to wait runs after the current
// one, so a tap made mid-flush is never stranded until the timer.
const chains = new Map<string, Promise<void>>();

export function flushMatch(userId: string, matchId: string): Promise<void> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks?.request) {
    return locks.request(`vv-queue-${matchId}`, () => flushLoop(userId, matchId)).then(() => {}, () => {});
  }
  const run = (chains.get(matchId) ?? Promise.resolve()).then(() => flushLoop(userId, matchId)).catch(() => {});
  chains.set(matchId, run);
  return run;
}

/** Every match this user has queued taps for: start-up, reconnect, resume, timer. */
export async function flushAll(userId: string): Promise<void> {
  for (const matchId of queuedMatchIds(userId)) await flushMatch(userId, matchId);
}
