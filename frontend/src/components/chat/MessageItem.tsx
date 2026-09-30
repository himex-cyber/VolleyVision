import { useState } from 'react';
import type { ChatAttachment, ChatMessage } from '../../types';
import { formatBytes } from './format';

/** "just now" → "5m" → "3h" → "Tue 14:02" → "12 Jun" — courtside-glance sizes. */
// eslint-disable-next-line react-refresh/only-export-components -- shared time formatter belongs next to the message bubble that uses it, not split into its own file
export function formatMessageTime(iso: string): string {
  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  if (hours < 24 * 7) {
    return `${then.toLocaleDateString(undefined, { weekday: 'short' })} ${then.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  }
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function AttachmentView({
  attachment,
  onImageError,
}: {
  attachment: ChatAttachment;
  onImageError?: () => void;
}) {
  if (attachment.kind === 'IMAGE') {
    if (!attachment.signedUrl) {
      return (
        <div className="w-40 h-24 rounded-lg border border-grey-200 bg-grey-50 flex items-center justify-center">
          <span className="text-xs text-grey-600">Image unavailable</span>
        </div>
      );
    }
    return (
      <a href={attachment.signedUrl} target="_blank" rel="noreferrer" title={attachment.fileName}>
        <img
          src={attachment.signedUrl}
          alt={attachment.fileName}
          loading="lazy"
          // A 403 here usually means the signed URL expired in a long-idle
          // tab — the handler refetches the page for fresh URLs.
          onError={onImageError}
          // Stored dimensions reserve the box before the bytes arrive — no layout shift.
          style={
            attachment.width && attachment.height
              ? { aspectRatio: `${attachment.width} / ${attachment.height}` }
              : undefined
          }
          className="max-h-64 max-w-full w-auto rounded-lg border border-grey-200 bg-grey-50 object-contain"
        />
      </a>
    );
  }

  const chipInner = (
    <>
      <span className="w-8 h-8 rounded bg-navy-100 text-navy-700 text-[10px] font-bold flex items-center justify-center shrink-0 uppercase">
        {attachment.fileName.split('.').pop()?.slice(0, 4) || 'file'}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-grey-900 truncate">{attachment.fileName}</span>
        <span className="block text-[10px] text-grey-600">
          {attachment.signedUrl ? formatBytes(attachment.sizeBytes) : 'unavailable'}
        </span>
      </span>
    </>
  );

  if (!attachment.signedUrl) {
    return (
      <div className="flex items-center gap-2 bg-grey-50 border border-grey-200 rounded-lg pl-1.5 pr-3 py-1.5 max-w-60 opacity-60">
        {chipInner}
      </div>
    );
  }
  return (
    <a
      href={attachment.signedUrl}
      target="_blank"
      rel="noreferrer"
      download={attachment.fileName}
      className="flex items-center gap-2 bg-grey-50 border border-grey-200 rounded-lg pl-1.5 pr-3 py-1.5 max-w-60 hover:border-gold-500 transition-colors"
    >
      {chipInner}
    </a>
  );
}

interface MessageItemProps {
  message: ChatMessage;
  isOwn: boolean;
  /** Own-message actions need posting rights; moderators may delete any message. */
  canPost: boolean;
  canModerate: boolean;
  onEdit: (messageId: string, body: string) => void;
  onDelete: (messageId: string) => void;
  onRetry: (tempId: string) => void;
  onDiscardFailed: (tempId: string) => void;
  /** An <img> failed to load — likely an expired signed URL; refetch fresh ones. */
  onStaleAttachment?: () => void;
}

export default function MessageItem({
  message,
  isOwn,
  canPost,
  canModerate,
  onEdit,
  onDelete,
  onRetry,
  onDiscardFailed,
  onStaleAttachment,
}: MessageItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const isDeleted = !!message.deletedAt;
  const isFailed = message.sendState === 'failed';
  const isSending = message.sendState === 'sending';
  const senderName = message.sender
    ? `${message.sender.firstName} ${message.sender.lastName}`
    : 'Former member';
  const initials = message.sender
    ? `${message.sender.firstName[0] ?? ''}${message.sender.lastName[0] ?? ''}`
    : '—';

  function saveEdit() {
    const body = draft.trim();
    if (body && body !== message.body) onEdit(message.id, body);
    setEditing(false);
  }

  return (
    <div className="group flex items-start gap-3 px-5 py-2 hover:bg-grey-50">
      {message.sender?.profileImage ? (
        <img
          src={message.sender.profileImage}
          alt=""
          className="w-9 h-9 rounded-full object-cover shrink-0 mt-0.5"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-navy-100 flex items-center justify-center font-bold text-sm text-navy-700 shrink-0 mt-0.5">
          {initials}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-semibold ${message.sender ? 'text-grey-900' : 'text-grey-600 italic'}`}>
            {senderName}
          </span>
          <span className="text-xs text-grey-600">
            {isSending ? 'sending…' : formatMessageTime(message.createdAt)}
          </span>
          {message.editedAt && !isDeleted && (
            <span className="text-xs text-grey-600 italic">(edited)</span>
          )}
        </div>

        {isDeleted ? (
          <p className="text-sm text-grey-600 italic mt-0.5">
            {/* No sender: its author deleted their account (9.4). */}
            {message.sender ? 'Message deleted' : 'Message from a former member was removed'}
          </p>
        ) : editing ? (
          <div className="mt-1">
            <textarea
              className="input text-sm py-2"
              rows={2}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <div className="flex gap-2 mt-1.5">
              <button className="btn-primary text-xs px-3 py-1.5" onClick={saveEdit}>Save</button>
              <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            {message.body && (
              <p className={`text-sm whitespace-pre-wrap break-words mt-0.5 ${isSending ? 'text-grey-600' : 'text-grey-900'}`}>
                {message.body}
              </p>
            )}
            {message.attachments.length > 0 && (
              <div className={`flex flex-wrap gap-2 mt-1.5 ${isSending ? 'opacity-70' : ''}`}>
                {message.attachments.map((a) => (
                  <AttachmentView
                    key={a.id}
                    attachment={a}
                    onImageError={message.sendState ? undefined : onStaleAttachment}
                  />
                ))}
              </div>
            )}
            {isSending && message.uploadProgress !== undefined && (
              <div className="flex items-center gap-2 mt-1.5 max-w-60" aria-label="Upload progress">
                <div className="flex-1 h-1.5 rounded-full bg-grey-200 overflow-hidden">
                  <div
                    className="h-full bg-gold-500 transition-all"
                    style={{ width: `${message.uploadProgress}%` }}
                  />
                </div>
                <span className="text-[10px] text-grey-600 tabular-nums">{message.uploadProgress}%</span>
              </div>
            )}
          </>
        )}

        {isFailed && (
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-error font-medium">
              {message.sendError ? `Couldn't send — ${message.sendError}` : 'Failed to send'}
            </span>
            <button className="text-xs font-semibold text-navy-700 hover:underline" onClick={() => onRetry(message.id)}>
              Retry
            </button>
            <button className="text-xs text-grey-600 hover:underline" onClick={() => onDiscardFailed(message.id)}>
              Discard
            </button>
          </div>
        )}
      </div>

      {!isDeleted && !message.sendState && !editing && (isOwn ? canPost : canModerate) && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
          {isOwn && canPost && (
            <button
              className="text-xs font-medium text-grey-600 hover:text-navy-700 px-1.5 py-1"
              onClick={() => { setDraft(message.body ?? ''); setEditing(true); }}
            >
              Edit
            </button>
          )}
          <button
            className="text-xs font-medium text-grey-600 hover:text-error px-1.5 py-1"
            onClick={() => onDelete(message.id)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
