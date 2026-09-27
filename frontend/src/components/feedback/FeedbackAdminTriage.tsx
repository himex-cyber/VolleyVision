import { useState } from 'react';
import { useAllFeedback, useUpdateFeedbackStatus } from '../../hooks';
import type { Feedback, FeedbackStatus } from '../../types/feedback';
import { AttachmentChips, STATUS_LABELS, TYPE_BADGE, TYPE_LABELS, TYPE_OPTIONS } from './MyFeedbackList';

const STATUS_OPTIONS: FeedbackStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX'];

function AdminFeedbackRow({ fb }: { fb: Feedback }) {
  const updateStatus = useUpdateFeedbackStatus();
  const [status, setStatus] = useState<FeedbackStatus>(fb.status);
  const [notes, setNotes] = useState(fb.adminNotes ?? '');
  const [error, setError] = useState('');

  const dirty = status !== fb.status || notes.trim() !== (fb.adminNotes ?? '');

  async function save() {
    setError('');
    try {
      await updateStatus.mutateAsync({ id: fb.id, data: { status, adminNotes: notes.trim() || null } });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Couldn't save. Try again.");
    }
  }

  return (
    <div className="px-5 py-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-grey-900 text-sm">{fb.subject}</p>
          <p className="text-grey-500 text-xs mt-0.5">
            {fb.user ? `${fb.user.firstName} ${fb.user.lastName} · ${fb.user.email}` : 'Unknown user'}
            {' · '}{new Date(fb.createdAt).toLocaleString()}
            {fb.severity && ` · ${fb.severity.charAt(0) + fb.severity.slice(1).toLowerCase()} severity`}
            {fb.pageContext && ` · from ${fb.pageContext}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`badge ${TYPE_BADGE[fb.type]}`}>{TYPE_LABELS[fb.type]}</span>
          <select
            className="input text-xs py-1.5 w-auto"
            value={status}
            aria-label={`Status for "${fb.subject}"`}
            onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
          >
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>
      </div>

      <p className="text-grey-700 text-sm whitespace-pre-wrap">{fb.description}</p>

      <AttachmentChips feedback={fb} />

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs text-grey-600 font-medium mb-1">Admin notes (visible to the submitter)</label>
          <textarea
            className="input text-sm resize-y min-h-16"
            placeholder="What was done about it…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={5000}
          />
        </div>
        <button
          type="button"
          className="btn-primary text-xs px-3 py-2 shrink-0"
          disabled={!dirty || updateStatus.isPending}
          onClick={save}
        >
          {updateStatus.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <p className="text-error text-xs">{error}</p>}
    </div>
  );
}

export default function FeedbackAdminTriage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useAllFeedback({
    status: statusFilter || undefined,
    type: typeFilter || undefined,
  });
  const all = data?.pages.flatMap((p) => p.items);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-grey-600">All Feedback (admin)</h2>

      <div className="card p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-grey-600 mb-1">Status</label>
          <select className="input text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-grey-600 mb-1">Type</label>
          <select className="input text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-grey-600 text-sm">Loading all feedback…</p>
      ) : !all?.length ? (
        <div className="card p-8 text-center">
          <p className="text-grey-900 font-medium">No feedback{statusFilter || typeFilter ? ' matching these filters' : ' yet'}</p>
        </div>
      ) : (
        <>
          <div className="card overflow-hidden divide-y divide-grey-200">
            {all.map((fb) => <AdminFeedbackRow key={fb.id} fb={fb} />)}
          </div>
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
        </>
      )}
    </section>
  );
}
