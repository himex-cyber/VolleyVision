import { useState } from 'react';
import { useVideoClips, useUpdateClip, useDeleteClip } from '../../hooks';
import type { VideoClip } from '../../types';
import type { YouTubePlayerHandle } from './YouTubePlayer';

/** `1:23` / `1:02:03` — mirrors backend lib/videoClips.ts formatTimecode. */
export function formatTimecode(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Set number lives on the linked event. A manual clip has none, and a clip
 * whose event was later deleted has none either — it survives as an orphan
 * range, because the moment still happened.
 */
function setOf(clip: VideoClip): number | null {
  return clip.event?.setNumber ?? null;
}

function ClipRow({
  clip,
  videoId,
  player,
}: {
  clip: VideoClip;
  videoId: string;
  player: React.RefObject<YouTubePlayerHandle | null>;
}) {
  const updateClip = useUpdateClip(videoId);
  const deleteClip = useDeleteClip(videoId);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(clip.label);

  const length = clip.endSeconds - clip.startSeconds;

  function save() {
    const trimmed = label.trim();
    if (!trimmed || trimmed === clip.label) { setEditing(false); return; }
    updateClip.mutate({ clipId: clip.id, label: trimmed });
    setEditing(false);
  }

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 bg-grey-50 hover:bg-navy-100 group transition-colors">
      <button
        className="tabular text-xs text-navy-700 font-semibold shrink-0 w-24 text-left hover:text-gold-600"
        onClick={() => player.current?.playRange(clip.startSeconds, clip.endSeconds)}
        title="Play this clip"
      >
        {formatTimecode(clip.startSeconds)}–{formatTimecode(clip.endSeconds)}
      </button>

      {editing ? (
        <input
          className="input text-sm flex-1 py-1"
          value={label}
          autoFocus
          onChange={(e) => setLabel(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') { setLabel(clip.label); setEditing(false); }
          }}
        />
      ) : (
        <button
          className="text-sm text-grey-900 flex-1 text-left truncate"
          onClick={() => player.current?.playRange(clip.startSeconds, clip.endSeconds)}
        >
          {clip.label}
        </button>
      )}

      <span className="text-xs text-grey-600 shrink-0 tabular">{length}s</span>

      <div className="flex gap-2 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button className="text-grey-400 hover:text-navy-700 text-xs" onClick={() => setEditing(true)}>
          Rename
        </button>
        <button
          className="text-grey-400 hover:text-error-strong text-xs"
          onClick={() => deleteClip.mutate(clip.id)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function ClipList({
  videoId,
  player,
}: {
  videoId: string;
  player: React.RefObject<YouTubePlayerHandle | null>;
}) {
  const { data: clips, isLoading } = useVideoClips(videoId);

  if (isLoading) return <p className="text-xs text-grey-600">Loading clips…</p>;
  if (!clips?.length) {
    return (
      <p className="text-xs text-grey-600 italic">
        No clips yet. Generate them from tracked events, or mark a range by hand.
      </p>
    );
  }

  // Grouped by set so a coach can jump to "everything in set 3". Clips with no
  // set (manual, or orphaned by a deleted event) collect at the end.
  const groups = new Map<number | null, VideoClip[]>();
  for (const clip of clips) {
    const key = setOf(clip);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(clip);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    if (a[0] === null) return 1;
    if (b[0] === null) return -1;
    return a[0] - b[0];
  });

  return (
    <div className="space-y-4">
      {ordered.map(([setNumber, setClips]) => (
        <div key={setNumber ?? 'unsorted'} className="space-y-1">
          <h4 className="font-display text-xs font-semibold uppercase tracking-wide text-grey-600">
            {setNumber === null ? 'Other clips' : `Set ${setNumber}`}
            <span className="ml-2 font-sans normal-case tracking-normal text-grey-400">{setClips.length}</span>
          </h4>
          {setClips.map((clip) => (
            <ClipRow key={clip.id} clip={clip} videoId={videoId} player={player} />
          ))}
        </div>
      ))}
    </div>
  );
}
