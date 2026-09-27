import { useLayoutEffect, useRef } from 'react';
import type { ChatMessage } from '../../types';
import MessageItem from './MessageItem';

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: string | undefined;
  canPost: boolean;
  canModerate: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  onEdit: (messageId: string, body: string) => void;
  onDelete: (messageId: string) => void;
  onRetry: (tempId: string) => void;
  onDiscardFailed: (tempId: string) => void;
  onStaleAttachment?: () => void;
}

export default function MessageList({
  messages,
  currentUserId,
  canPost,
  canModerate,
  hasMoreOlder,
  isLoadingOlder,
  onLoadOlder,
  onEdit,
  onDelete,
  onRetry,
  onDiscardFailed,
  onStaleAttachment,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);
  const prependingRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  const lastMessage = messages[messages.length - 1];

  // Auto-scroll to the newest message when one arrives — but only if the user
  // is already near the bottom (or it's their own send). Restore position after
  // an older page is prepended so history doesn't jump.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (prependingRef.current) {
      const { scrollHeight, scrollTop } = prependingRef.current;
      el.scrollTop = el.scrollHeight - scrollHeight + scrollTop;
      prependingRef.current = null;
      return;
    }

    const lastId = lastMessage?.id ?? null;
    if (lastId === lastIdRef.current) return;
    const isFirstRender = lastIdRef.current === null;
    lastIdRef.current = lastId;
    if (!lastId) return;

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    const isOwnSend = !!lastMessage?.sendState && lastMessage.senderId === currentUserId;
    if (isFirstRender || nearBottom || isOwnSend) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lastMessage?.id, lastMessage?.sendState, lastMessage?.senderId, currentUserId, messages.length]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el || !hasMoreOlder || isLoadingOlder) return;
    if (el.scrollTop < 40) {
      prependingRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
      onLoadOlder();
    }
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <p className="font-display font-semibold text-grey-900">No messages yet</p>
          <p className="text-sm text-grey-600 mt-1">Start the conversation with your team.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto py-3"
      role="log"
      aria-label="Team messages"
      aria-live="polite"
      tabIndex={0}
    >
      {hasMoreOlder && (
        <div className="text-center pb-2">
          <button
            className="text-xs font-medium text-navy-700 hover:underline disabled:opacity-50"
            disabled={isLoadingOlder}
            onClick={() => {
              const el = containerRef.current;
              if (el) prependingRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
              onLoadOlder();
            }}
          >
            {isLoadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        </div>
      )}
      {messages.map((m) => (
        <MessageItem
          key={m.id}
          message={m}
          isOwn={!!currentUserId && m.senderId === currentUserId}
          canPost={canPost}
          canModerate={canModerate}
          onEdit={onEdit}
          onDelete={onDelete}
          onRetry={onRetry}
          onDiscardFailed={onDiscardFailed}
          onStaleAttachment={onStaleAttachment}
        />
      ))}
    </div>
  );
}
