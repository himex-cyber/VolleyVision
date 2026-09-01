import { useState } from 'react';
import { useMyFeedback } from '../../hooks';
import { feedbackApi } from '../../lib/api';
import type { Feedback, FeedbackStatus, FeedbackType } from '../../types/feedback';
import { formatBytes } from '../chat/format';

// The feedback views (submit, mine, admin triage) share this vocabulary, so it is
// declared once here rather than copied into each of them.
export const TYPE_LABELS: Record<FeedbackType, string> = {
  BUG: 'Bug report',
  FEATURE_REQUEST: 'Feature request',
  GENERAL: 'General',
};

export const TYPE_BADGE: Record<FeedbackType, string> = {
  BUG: 'badge-error',
  FEATURE_REQUEST: 'badge-info',
  GENERAL: 'badge-neutral',
};

export const STATUS_LABELS: Record<FeedbackStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  WONT_FIX: "Won't fix",
};

const STATUS_BADGE: Record<FeedbackStatus, string> = {
  OPEN: 'badge-neutral',
  IN_PROGRESS: 'badge-accent',
  RESOLVED: 'badge-success',
  WONT_FIX: 'badge-neutral',
};

export const TYPE_OPTIONS: FeedbackType[] = ['BUG', 'FEATURE_REQUEST', 'GENERAL'];

/** Fetch a short-lived signed URL and open the attachment in a new tab. */
async function openAttachment(feedbackId: string, attachmentId: string, onError: (msg: string) => void) {
  try {
    const url = await feedbackApi.getAttachmentUrl(feedbackId, attachmentId);
    window.open(url, '_blank', 'noopener');
  } catch (err: any) {
    onError(err?.response?.data?.error ?? "Couldn't open that attachment. Try again.");
  }
}

export function AttachmentChips({ feedback }: { feedback: Feedback }) {
  const [error, setError] = useState('');
  if (feedback.attachments.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5">
        {feedback.attachments.map((a) => (
          <button
            key={a.id}
            type="button"
            className="flex items-center gap-1.5 bg-grey-50 border border-grey-200 rounded-lg px-2 py-1 text-xs text-grey-700 hover:text-navy-700 hover:border-gold-500 transition-colors max-w-56"
            title={`Open ${a.originalName}`}
            onClick={() => openAttachment(feedback.id, a.id, setError)}
          >
            <span aria-hidden>{a.kind === 'IMAGE' ? '🖼' : '📄'}</span>
            <span className="truncate font-medium">{a.originalName}</span>
            <span className="text-grey-500 shrink-0">{formatBytes(a.sizeBytes)}</span>
          </button>
        ))}
      </div>
      {error && <p className="text-error text-xs">{error}</p>}
    </div>
  );
}

function MyFeedbackCard({ fb }: { fb: Feedback }) {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-grey-900 text-base">{fb.subject}</p>
          <p className="text-grey-500 text-xs mt-0.5">
            Submitted {new Date(fb.createdAt).toLocaleDateString()}
            {fb.severity && ` · ${fb.severity.charAt(0) + fb.severity.slice(1).toLowerCase()} severity`}
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0 mt-0.5">
          <span className={`badge ${TYPE_BADGE[fb.type]}`}>{TYPE_LABELS[fb.type]}</span>
          <span className={`badge ${STATUS_BADGE[fb.status]}`}>{STATUS_LABELS[fb.status]}</span>
        </div>
      </div>

      <p className="text-grey-700 text-sm whitespace-pre-wrap">{fb.description}</p>

      <AttachmentChips feedback={fb} />

      {fb.adminNotes && (
        <div className="bg-navy-100/50 border border-navy-100 rounded-lg px-3 py-2">
          <p className="text-xs font-semibold text-navy-700 mb-0.5">Response from the VolleyVision team</p>
          <p className="text-sm text-grey-900 whitespace-pre-wrap">{fb.adminNotes}</p>
        </div>
      )}
    </div>
  );
}

export default function MyFeedbackList() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useMyFeedback();
  const mine = data?.pages.flatMap((p) => p.items);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-grey-600">Your Feedback</h2>
      {isLoading ? (
        <p className="text-grey-600 text-sm">Loading your feedback…</p>
      ) : !mine?.length ? (
        <div className="card p-8 text-center">
          <p className="text-grey-900 font-medium">Nothing submitted yet</p>
          <p className="text-grey-600 text-sm mt-1">Bug reports and ideas you submit will appear here with their status.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {mine.map((fb) => <MyFeedbackCard key={fb.id} fb={fb} />)}
          {hasNextPage && (
            <button
              type="button"
              className="btn-ghost text-sm w-full"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
