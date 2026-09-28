import { useEffect, useRef, useState } from 'react';
import {
  CHAT_ACCEPT_ATTR,
  CHAT_MAX_ATTACHMENTS,
  formatBytes,
  rejectFileReason,
} from './format';

const MAX_LENGTH = 4000;

interface SelectedFile {
  file: File;
  /** Object URL for image thumbnails; null for non-images. */
  previewUrl: string | null;
}

interface MessageComposerProps {
  onSend: (body: string) => void;
  onSendWithFiles: (body: string | undefined, files: File[]) => void;
  disabled?: boolean;
}

export default function MessageComposer({ onSend, onSendWithFiles, disabled }: MessageComposerProps) {
  const [value, setValue] = useState('');
  const [selected, setSelected] = useState<SelectedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trimmed = value.trim();
  const overLimit = trimmed.length > MAX_LENGTH;
  const canSend = !disabled && !overLimit && (trimmed.length > 0 || selected.length > 0);

  // Revoke any leftover previews on unmount only — day-to-day revocation
  // happens in removeFile/send.
  useEffect(() => {
    return () => {
      setSelected((cur) => {
        cur.forEach((s) => s.previewUrl && URL.revokeObjectURL(s.previewUrl));
        return cur;
      });
    };
  }, []);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFileError(null);
    const additions: SelectedFile[] = [];
    for (const file of Array.from(list)) {
      if (selected.length + additions.length >= CHAT_MAX_ATTACHMENTS) {
        setFileError(`You can attach at most ${CHAT_MAX_ATTACHMENTS} files per message.`);
        break;
      }
      const reason = rejectFileReason(file);
      if (reason) {
        setFileError(reason);
        continue;
      }
      additions.push({
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }
    if (additions.length) setSelected((cur) => [...cur, ...additions]);
  }

  function removeFile(index: number) {
    setSelected((cur) => {
      const target = cur[index];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return cur.filter((_, i) => i !== index);
    });
    setFileError(null);
  }

  function send() {
    if (!canSend) return;
    if (selected.length > 0) {
      // The upload hook builds its own previews from the Files — release ours.
      selected.forEach((s) => s.previewUrl && URL.revokeObjectURL(s.previewUrl));
      onSendWithFiles(trimmed || undefined, selected.map((s) => s.file));
      setSelected([]);
    } else {
      onSend(trimmed);
    }
    setValue('');
    setFileError(null);
    textareaRef.current?.focus();
  }

  return (
    <div className="border-t border-grey-200 p-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-2">
          {selected.map((s, i) => (
            <div
              key={`${s.file.name}-${i}`}
              className="flex items-center gap-2 bg-grey-50 border border-grey-200 rounded-lg pl-1.5 pr-2 py-1.5 max-w-56"
            >
              {s.previewUrl ? (
                <img src={s.previewUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
              ) : (
                <span className="w-8 h-8 rounded bg-navy-100 text-navy-700 text-[10px] font-bold flex items-center justify-center shrink-0 uppercase">
                  {s.file.name.split('.').pop()?.slice(0, 4) || 'file'}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-grey-900 truncate">{s.file.name}</p>
                <p className="text-[10px] text-grey-600">{formatBytes(s.file.size)}</p>
              </div>
              <button
                className="text-grey-600 hover:text-error text-sm leading-none px-0.5"
                aria-label={`Remove ${s.file.name}`}
                onClick={() => removeFile(i)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
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
        <button
          className="shrink-0 w-10 h-10 rounded-xl border border-grey-200 text-grey-600 hover:text-navy-700 hover:border-gold-500 transition-colors flex items-center justify-center disabled:opacity-50"
          aria-label="Attach files"
          title="Attach files"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          className="input text-sm py-2.5 resize-none"
          rows={value.includes('\n') ? 3 : 1}
          placeholder="Message your team…"
          aria-label="Message your team"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn-primary text-sm px-4 py-2.5 shrink-0" onClick={send} disabled={!canSend}>
          Send
        </button>
      </div>

      {fileError && <p className="text-xs text-error mt-1">{fileError}</p>}
      {(overLimit || trimmed.length > MAX_LENGTH - 500) && (
        <p className={`text-xs mt-1 ${overLimit ? 'text-error' : 'text-grey-600'}`}>
          {trimmed.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()} characters
          {overLimit && ' — too long to send'}
        </p>
      )}
    </div>
  );
}
