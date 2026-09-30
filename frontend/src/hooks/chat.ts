// Team Chat data hooks. The message cache for a channel is a single ascending
// ChatMessage[] under ['chat','messages',channelId]:
//   - server messages, ordered by (createdAt, id) — the backend's timeline order
//   - then any optimistic entries (sendState 'sending' | 'failed') at the tail
// Polling appends deltas via ?after=<last server id> (the foundation contract);
// every few ticks it refetches the newest page instead so edits and moderator
// deletes made by OTHERS become visible without a reload.

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chatApi } from '../lib/api';
import { newKey } from '../lib/eventQueue';
import { useAuth } from '../context/AuthContext';
import type { ChatAttachment, ChatMessage } from '../types';

const PAGE_SIZE = 30;
export const POLL_INTERVAL_MS = 5000;
// Every Nth poll is a full newest-page refresh instead of an after= delta.
const FULL_REFRESH_EVERY = 6;

const messagesKey = (channelId: string) => ['chat', 'messages', channelId] as const;

function isServerMessage(m: ChatMessage): boolean {
  return !m.sendState;
}

function lastServerId(list: ChatMessage[]): string | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    if (isServerMessage(list[i])) return list[i].id;
  }
  return undefined;
}

/**
 * Merge server rows into the cache. Incoming rows win on id collision (fresh
 * edits/tombstones), server order is re-derived from (createdAt, id) — ISO
 * strings compare lexicographically — and optimistic entries stay at the tail.
 */
function mergeServer(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of existing) if (isServerMessage(m)) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  const server = [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt
      ? (a.id < b.id ? -1 : 1)
      : (a.createdAt < b.createdAt ? -1 : 1),
  );
  return [...server, ...existing.filter((m) => !isServerMessage(m))];
}

// ─── Channel ──────────────────────────────────────────────────────────────────

export function useTeamChannel(teamId: string) {
  return useQuery({
    queryKey: ['chat', 'channel', teamId],
    queryFn: () => chatApi.getChannel(teamId),
    enabled: !!teamId,
    staleTime: Infinity, // one immutable TEAM channel per team
  });
}

// ─── Messages (polled) ────────────────────────────────────────────────────────

export function useMessages(channelId: string | undefined) {
  const qc = useQueryClient();
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const pollCount = useRef(0);

  const query = useQuery({
    queryKey: messagesKey(channelId ?? ''),
    enabled: !!channelId,
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: 0,
    queryFn: async (): Promise<ChatMessage[]> => {
      const cached = qc.getQueryData<ChatMessage[]>(messagesKey(channelId!)) ?? [];
      const anchor = lastServerId(cached);

      if (!anchor) {
        const initial = await chatApi.listMessages(channelId!, { limit: PAGE_SIZE });
        setHasMoreOlder(initial.length === PAGE_SIZE);
        return mergeServer(cached, initial);
      }

      pollCount.current += 1;
      if (pollCount.current % FULL_REFRESH_EVERY === 0) {
        // Periodic newest-page refresh so other members' edits/deletes land.
        return mergeServer(cached, await chatApi.listMessages(channelId!, { limit: PAGE_SIZE }));
      }
      return mergeServer(cached, await chatApi.listMessages(channelId!, { after: anchor }));
    },
  });

  // Signed attachment URLs expire (~1h). When an image 403s in a long-idle
  // tab, refetch the newest page (debounced) to mint fresh URLs.
  const lastUrlRefresh = useRef(0);
  const refreshLatest = useCallback(async () => {
    if (!channelId) return;
    const now = Date.now();
    if (now - lastUrlRefresh.current < 5000) return;
    lastUrlRefresh.current = now;
    const latest = await chatApi.listMessages(channelId, { limit: PAGE_SIZE });
    qc.setQueryData<ChatMessage[]>(messagesKey(channelId), (cur = []) => mergeServer(cur, latest));
  }, [channelId, qc]);

  /** Page older history in (scroll-up / "load older"). */
  const loadOlder = useCallback(async () => {
    if (!channelId || isLoadingOlder) return;
    const cached = qc.getQueryData<ChatMessage[]>(messagesKey(channelId)) ?? [];
    const oldest = cached.find(isServerMessage);
    if (!oldest) return;
    setIsLoadingOlder(true);
    try {
      const older = await chatApi.listMessages(channelId, { before: oldest.id, limit: PAGE_SIZE });
      setHasMoreOlder(older.length === PAGE_SIZE);
      if (older.length > 0) {
        qc.setQueryData<ChatMessage[]>(messagesKey(channelId), (cur = []) => mergeServer(cur, older));
      }
    } finally {
      setIsLoadingOlder(false);
    }
  }, [channelId, isLoadingOlder, qc]);

  return { ...query, loadOlder, isLoadingOlder, hasMoreOlder, refreshLatest };
}

/** User-facing message from an axios error, if the server sent one. */
function serverErrorMessage(err: unknown): string | undefined {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
}

// ─── Send (optimistic) ────────────────────────────────────────────────────────

export function usePostMessage(channelId: string | undefined) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const mutation = useMutation({
    // The tempId doubles as the Idempotency-Key: a retry reuses it, so the
    // server returns the original message if the first attempt actually landed.
    mutationFn: (vars: { body: string; tempId: string }) =>
      chatApi.postMessage(channelId!, vars.body, vars.tempId),
    onMutate: ({ body, tempId }) => {
      const optimistic: ChatMessage = {
        id: tempId,
        channelId: channelId!,
        senderId: user?.id ?? null,
        sender: user
          ? { id: user.id, firstName: user.firstName, lastName: user.lastName, profileImage: user.profileImage }
          : null,
        body,
        attachments: [],
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        sendState: 'sending',
      };
      // A retry reuses its tempId — drop the failed entry before re-appending.
      qc.setQueryData<ChatMessage[]>(messagesKey(channelId!), (cur = []) => [
        ...cur.filter((m) => m.id !== tempId),
        optimistic,
      ]);
    },
    onSuccess: (serverMessage, { tempId }) => {
      qc.setQueryData<ChatMessage[]>(messagesKey(channelId!), (cur = []) =>
        mergeServer(cur.filter((m) => m.id !== tempId), [serverMessage]),
      );
    },
    onError: (err, { tempId }) => {
      qc.setQueryData<ChatMessage[]>(messagesKey(channelId!), (cur = []) =>
        cur.map((m) =>
          m.id === tempId
            ? { ...m, sendState: 'failed' as const, sendError: serverErrorMessage(err) }
            : m,
        ),
      );
    },
  });

  const send = useCallback(
    (body: string) => mutation.mutate({ body, tempId: `temp-${newKey()}` }),
    [mutation],
  );

  /** Re-send a failed optimistic message under the same temp id. */
  const retry = useCallback(
    (tempId: string) => {
      if (!channelId) return;
      const cached = qc.getQueryData<ChatMessage[]>(messagesKey(channelId)) ?? [];
      const failed = cached.find((m) => m.id === tempId && m.sendState === 'failed');
      if (failed?.body) mutation.mutate({ body: failed.body, tempId });
    },
    [channelId, mutation, qc],
  );

  /** Drop a failed optimistic message without sending. */
  const discardFailed = useCallback(
    (tempId: string) => {
      if (!channelId) return;
      qc.setQueryData<ChatMessage[]>(messagesKey(channelId), (cur = []) =>
        cur.filter((m) => m.id !== tempId),
      );
    },
    [channelId, qc],
  );

  return { send, retry, discardFailed, isPending: mutation.isPending };
}

// ─── Upload (attachments, optimistic with progress) ──────────────────────────

interface PendingUpload {
  body?: string;
  files: File[];
  /** Object-URL previews, created once and revoked on success/discard. */
  attachments: ChatAttachment[];
}

export function useUploadMessage(channelId: string | undefined) {
  const qc = useQueryClient();
  const { user } = useAuth();
  // Failed payloads keep their File objects so retry can re-send them.
  const pending = useRef(new Map<string, PendingUpload>());

  const revokePreviews = useCallback((tempId: string) => {
    const entry = pending.current.get(tempId);
    entry?.attachments.forEach((a) => {
      if (a.signedUrl?.startsWith('blob:')) URL.revokeObjectURL(a.signedUrl);
    });
    pending.current.delete(tempId);
  }, []);

  const mutation = useMutation({
    mutationFn: ({ tempId }: { tempId: string }) => {
      const entry = pending.current.get(tempId);
      if (!entry) throw new Error('Upload payload missing.');
      return chatApi.uploadMessage(channelId!, {
        body: entry.body,
        files: entry.files,
        idempotencyKey: tempId, // reused on retry → no duplicate message
        onProgress: (percent) => {
          qc.setQueryData<ChatMessage[]>(messagesKey(channelId!), (cur = []) =>
            cur.map((m) => (m.id === tempId ? { ...m, uploadProgress: percent } : m)),
          );
        },
      });
    },
    onMutate: ({ tempId }) => {
      const entry = pending.current.get(tempId);
      const optimistic: ChatMessage = {
        id: tempId,
        channelId: channelId!,
        senderId: user?.id ?? null,
        sender: user
          ? { id: user.id, firstName: user.firstName, lastName: user.lastName, profileImage: user.profileImage }
          : null,
        body: entry?.body ?? null,
        attachments: entry?.attachments ?? [],
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        sendState: 'sending',
        uploadProgress: 0,
      };
      qc.setQueryData<ChatMessage[]>(messagesKey(channelId!), (cur = []) => [
        ...cur.filter((m) => m.id !== tempId),
        optimistic,
      ]);
    },
    onSuccess: (serverMessage, { tempId }) => {
      revokePreviews(tempId);
      qc.setQueryData<ChatMessage[]>(messagesKey(channelId!), (cur = []) =>
        mergeServer(cur.filter((m) => m.id !== tempId), [serverMessage]),
      );
    },
    onError: (err, { tempId }) => {
      qc.setQueryData<ChatMessage[]>(messagesKey(channelId!), (cur = []) =>
        cur.map((m) =>
          m.id === tempId
            ? { ...m, sendState: 'failed' as const, uploadProgress: undefined, sendError: serverErrorMessage(err) }
            : m,
        ),
      );
    },
  });

  const sendWithFiles = useCallback(
    (body: string | undefined, files: File[]) => {
      const tempId = `temp-${newKey()}`;
      pending.current.set(tempId, {
        body,
        files,
        attachments: files.map((file, i) => ({
          id: `${tempId}-att-${i}`,
          kind: file.type.startsWith('image/') ? 'IMAGE' : 'FILE',
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          width: null,
          height: null,
          signedUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        })),
      });
      mutation.mutate({ tempId });
    },
    [mutation],
  );

  const retryUpload = useCallback(
    (tempId: string) => {
      if (pending.current.has(tempId)) mutation.mutate({ tempId });
    },
    [mutation],
  );

  const discardUpload = useCallback(
    (tempId: string) => {
      if (!channelId) return;
      revokePreviews(tempId);
      qc.setQueryData<ChatMessage[]>(messagesKey(channelId), (cur = []) =>
        cur.filter((m) => m.id !== tempId),
      );
    },
    [channelId, qc, revokePreviews],
  );

  /** True when the tempId belongs to an upload (vs a plain text send). */
  const ownsTempId = useCallback((tempId: string) => pending.current.has(tempId), []);

  return { sendWithFiles, retryUpload, discardUpload, ownsTempId, isUploading: mutation.isPending };
}

// ─── Edit / delete (optimistic with rollback) ────────────────────────────────

export function useEditMessage(channelId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { messageId: string; body: string }) =>
      chatApi.editMessage(vars.messageId, vars.body),
    onMutate: ({ messageId, body }) => {
      const key = messagesKey(channelId ?? '');
      const previous = qc.getQueryData<ChatMessage[]>(key);
      qc.setQueryData<ChatMessage[]>(key, (cur = []) =>
        cur.map((m) => (m.id === messageId ? { ...m, body, editedAt: new Date().toISOString() } : m)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(messagesKey(channelId ?? ''), ctx.previous);
    },
    onSuccess: (serverMessage) => {
      qc.setQueryData<ChatMessage[]>(messagesKey(channelId ?? ''), (cur = []) =>
        mergeServer(cur, [serverMessage]),
      );
    },
  });
}

export function useDeleteMessage(channelId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => chatApi.deleteMessage(messageId),
    onMutate: (messageId) => {
      const key = messagesKey(channelId ?? '');
      const previous = qc.getQueryData<ChatMessage[]>(key);
      qc.setQueryData<ChatMessage[]>(key, (cur = []) =>
        cur.map((m) =>
          m.id === messageId
            ? { ...m, body: null, attachments: [], editedAt: null, deletedAt: new Date().toISOString() }
            : m,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(messagesKey(channelId ?? ''), ctx.previous);
    },
    onSuccess: (tombstone) => {
      qc.setQueryData<ChatMessage[]>(messagesKey(channelId ?? ''), (cur = []) =>
        mergeServer(cur, [tombstone]),
      );
    },
  });
}
