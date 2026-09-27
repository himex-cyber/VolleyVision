import { useRef, useState } from 'react';
import { useCreateFeedback } from '../../hooks';
import type { FeedbackSeverity, FeedbackType } from '../../types/feedback';
import { CHAT_ACCEPT_ATTR, formatBytes, rejectFileReason } from '../chat/format';
import { TYPE_LABELS, TYPE_OPTIONS } from './MyFeedbackList';

// Bug screenshots, not chat threads — tighter cap than chat's 10.
const MAX_FEEDBACK_ATTACHMENTS = 5;

const SEVERITY_OPTIONS: FeedbackSeverity[] = ['LOW', 'MEDIUM', 'HIGH'];

export default function FeedbackSubmitForm() {
  const createFeedback = useCreateFeedback();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<FeedbackType>('BUG');
  const [severity, setSeverity] = useState<FeedbackSeverity | ''>('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFileError('');
    const additions: File[] = [];
    for (const file of Array.from(list)) {
      if (files.length + additions.length >= MAX_FEEDBACK_ATTACHMENTS) {
        setFileError(`You can attach at most ${MAX_FEEDBACK_ATTACHMENTS} files.`);
        break;
      }
      const reason = rejectFileReason(file);
      if (reason) {
        setFileError(reason);
        continue;
      }
      additions.push(file);
    }
    if (additions.length) setFiles((cur) => [...cur, ...additions]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setNotice('');
    try {
      await createFeedback.mutateAsync({
        type,
        severity: type === 'BUG' && severity ? severity : undefined,
        subject: subject.trim(),
        description: description.trim(),
        pageContext: window.location.pathname,
        files,
      });
      setType('BUG'); setSeverity(''); setSubject(''); setDescription(''); setFiles([]); setFileError('');
      setNotice('Thanks — your feedback has been submitted.');
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Couldn't submit your feedback. Try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-5 space-y-4">
      <h2 className="font-display font-bold text-lg text-grey-900">Submit Feedback</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-grey-600 font-medium mb-1">Type</label>
          <select className="input text-sm" value={type} onChange={(e) => setType(e.target.value as FeedbackType)}>
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        {type === 'BUG' && (
          <div>
            <label className="block text-xs text-grey-600 font-medium mb-1">Severity (optional)</label>
            <select className="input text-sm" value={severity} onChange={(e) => setSeverity(e.target.value as FeedbackSeverity | '')}>
              <option value="">Not sure</option>
              {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-grey-600 font-medium mb-1">Subject</label>
        <input
          className="input text-sm"
          placeholder={type === 'BUG' ? 'e.g. Score resets when I undo a point' : 'A short summary'}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          required
        />
      </div>

      <div>
        <label className="block text-xs text-grey-600 font-medium mb-1">Description</label>
        <textarea
          className="input text-sm resize-y min-h-28"
          placeholder={type === 'BUG' ? 'What happened, what you expected, and steps to reproduce…' : 'Tell us more…'}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          required
        />
      </div>

      {/* Attachments — same picker pattern as team chat, capped at 5. */}
      <div className="space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={CHAT_ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = ''; // allow re-selecting the same file
          }}
        />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-2 bg-grey-100 border border-grey-200 rounded-lg pl-2 pr-2 py-1.5 max-w-56">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-grey-900 truncate">{f.name}</p>
                  <p className="text-[10px] text-grey-600">{formatBytes(f.size)}</p>
                </div>
                <button
                  type="button"
                  className="text-grey-600 hover:text-error text-sm leading-none px-0.5"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => { setFiles((cur) => cur.filter((_, idx) => idx !== i)); setFileError(''); }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn-ghost text-xs px-3 py-1.5"
          onClick={() => fileInputRef.current?.click()}
        >
          + Attach files ({files.length}/{MAX_FEEDBACK_ATTACHMENTS})
        </button>
        {fileError && <p className="text-error text-xs">{fileError}</p>}
      </div>

      {error && <p className="text-error text-xs">{error}</p>}
      {notice && <p className="text-sm text-grey-900 bg-gold-500/10 rounded-lg px-3 py-2">{notice}</p>}

      <button type="submit" className="btn-primary text-sm" disabled={createFeedback.isPending}>
        {createFeedback.isPending ? 'Submitting…' : 'Submit Feedback'}
      </button>
    </form>
  );
}
