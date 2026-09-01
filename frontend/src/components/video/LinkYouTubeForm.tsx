import { useState } from 'react';
import { useLinkYouTubeVideo } from '../../hooks';

/**
 * Consent is a UX nudge, not a legal record, so localStorage is the right
 * weight: it stops us nagging a coach who has already read it, and nothing
 * depends on it being durable or auditable.
 */
const CONSENT_KEY = 'vv.video.youtubeConsent.v1';

function hasConsented(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'true';
  } catch {
    // Private mode or blocked storage — show the notice again rather than fail.
    return false;
  }
}

function rememberConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, 'true');
  } catch {
    /* Non-fatal: they just see the notice again next time. */
  }
}

export default function LinkYouTubeForm({ matchId }: { matchId: string }) {
  const linkVideo = useLinkYouTubeVideo(matchId);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(hasConsented);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !acknowledged) return;
    setError('');
    try {
      await linkVideo.mutateAsync(url.trim());
      setUrl('');
      rememberConsent();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Couldn't link that video. Check the link and try again.");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <h3 className="font-display text-base font-semibold text-navy-700">Add match video</h3>
        <p className="text-xs text-grey-600 mt-1">
          Upload your footage to YouTube as <span className="font-semibold">Unlisted</span>, then paste the link here.
        </p>
      </div>

      {/* Consent — plain and factual. An unlisted video is not private, and a
          coach filming players should know exactly what that means before
          pasting a link. */}
      {!hasConsented() && (
        <label className="flex gap-2 items-start rounded-lg border border-grey-200 bg-grey-50 p-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span className="text-xs text-grey-600 leading-relaxed">
            I understand that an unlisted YouTube video can be watched by anyone who has the link, and that
            VolleyVision does not control who it reaches. I&apos;ll follow my club&apos;s policy on filming players,
            including minors.
          </span>
        </label>
      )}

      <div className="flex gap-2 flex-wrap">
        <input
          className="input text-sm flex-1 min-w-[16rem]"
          placeholder="https://youtube.com/watch?v=…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={linkVideo.isPending}
        />
        <button className="btn-primary text-sm" disabled={!url.trim() || !acknowledged || linkVideo.isPending}>
          {linkVideo.isPending ? 'Linking…' : 'Link video'}
        </button>
      </div>

      {error && <p className="text-xs text-error-strong">{error}</p>}
    </form>
  );
}
