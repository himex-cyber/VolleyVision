import { useState } from 'react';
import { useMyFeedback } from '../../hooks';
import { feedbackApi, getApiErrorMessage } from '../../lib/api';
import type { Feedback, FeedbackStatus, FeedbackType } from '../../types/feedback';
import { formatBytes } from '../chat/format';
import { isNative } from '../../lib/native';

// The feedback views (submit, mine, admin triage) share this vocabulary, so it is
// declared once here rather than copied into each of them.
// eslint-disable-next-line react-refresh/only-export-components -- shared constant, deliberately colocated with the list that owns this vocabulary rather than split into its own file
export const TYPE_LABELS: Record<FeedbackType, string> = {
  BUG: 'Bug report',
  FEATURE_REQUEST: 'Feature request',
  GENERAL: 'General',
};

// eslint-disable-next-line react-refresh/only-export-components -- see TYPE_LABELS above
export const TYPE_BADGE: Record<FeedbackType, string> = {
  BUG: 'badge-error',
  FEATURE_REQUEST: 'badge-info',
  GENERAL: 'badge-neutral',
};

// eslint-disable-next-line react-refresh/only-export-components -- see TYPE_LABELS above
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

// eslint-disable-next-line react-refresh/only-export-components -- see TYPE_LABELS above
export const TYPE_OPTIONS: FeedbackType[] = ['BUG', 'FEATURE_REQUEST', 'GENERAL'];

/**
 * A window.open after an await is blocked by popup blockers and iOS WKWebView,
 * so on web the fetched signed URL (valid 3600 s) becomes a real link the user
 * taps. The native app hands the outside host to the system browser instead.
 */
function AttachmentChip({ feedbackId, a }: { feedbackId: string; a: Feedback['attachments'][number] }) {
  const [state, setState] = useState<{ loading: boolean; url?: string; error?: string }>({ loading: false });

  async function fetchUrl() {
    setState({ loading: true });
    try {
      const url = await feedbackApi.getAttachmentUrl(feedbackId, a.id);
      if (isNative()) {
        window.location.assign(url);
        setState({ loading: false });
      } else {
        setState({ loading: false, url });
      }
    } catch (err) {
      setState({ loading: false, error: getApiErrorMessage(err, "Couldn't open that attachment. Try again.") });
    }
  }

  return (
    <div className="flex flex-col gap-1 max-w-56">
      <button
        type="button"
        className="flex items-center gap-1.5 bg-grey-50 border border-grey-200 rounded-lg px-2 py-1 min-h-[44px] text-xs text-grey-900 hover:text-navy-700 hover:border-gold-500 transition-colors"
        title={`Open ${a.originalName}`}
        disabled={state.loading}
        onClick={fetchUrl}
      >
        <span aria-hidden>{a.kind === 'IMAGE' ? '🖼' : '📄'}</span>
        <span className="truncate font-medium">{a.originalName}</span>
        <span className="text-grey-600 shrink-0">{state.loading ? 'Loading…' : formatBytes(a.sizeBytes)}</span>
      </button>
      {state.url && (
        <a
          href={state.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary text-xs min-h-[44px] inline-flex items-center justify-center"
        >
          Open attachment
        </a>
      )}
      {state.error && <p className="text-error text-xs">{state.error}</p>}
    </div>
  );
}

export function AttachmentChips({ feedback }: { feedback: Feedback }) {
  if (feedback.attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {feedback.attachments.map((a) => <AttachmentChip key={a.id} feedbackId={feedback.id} a={a} />)}
    </div>
  );
}

function MyFeedbackCard({ fb }: { fb: Feedback }) {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-grey-900 text-base">{fb.subject}</p>
          <p className="text-grey-600 text-xs mt-0.5">
            Submitted {new Date(fb.createdAt).toLocaleDateString()}
            {fb.severity && ` · ${fb.severity.charAt(0) + fb.severity.slice(1).toLowerCase()} severity`}
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0 mt-0.5">
          <span className={`badge ${TYPE_BADGE[fb.type]}`}>{TYPE_LABELS[fb.type]}</span>
          <span className={`badge ${STATUS_BADGE[fb.status]}`}>{STATUS_LABELS[fb.status]}</span>
        </div>
      </div>

      <p className="text-grey-900 text-sm whitespace-pre-wrap">{fb.description}</p>

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
