import { useState } from 'react';
import { useCalibrateVideo, useClearGeneratedClips } from '../../hooks';
import type { Event, Video } from '../../types';
import type { YouTubePlayerHandle } from './YouTubePlayer';

/**
 * Sync a video to match time.
 *
 * One anchor does all the work: the coach scrubs to the first tracked event and
 * marks it, and every other event is placed by arithmetic from there. Anchoring
 * on a real event rather than the wall clock is what makes this survive a
 * tracking device whose clock is wrong — the same offset sits on both sides of
 * the subtraction and cancels out.
 */
export default function MatchSyncPanel({
  video,
  firstEvent,
  player,
  matchId,
}: {
  video: Video;
  firstEvent: Event | null;
  player: React.RefObject<YouTubePlayerHandle | null>;
  matchId: string;
}) {
  const calibrate = useCalibrateVideo(matchId, video.id);
  const clearGenerated = useClearGeneratedClips(video.id);
  const [result, setResult] = useState<{ matched: number; outside: number } | null>(null);
  const [error, setError] = useState('');

  const alreadySynced = !!video.recordingStartedAt;

  async function markMoment() {
    setError('');
    const seconds = player.current?.getCurrentTime() ?? 0;
    try {
      const res = await calibrate.mutateAsync(Math.floor(seconds));
      setResult({ matched: res.matchedEvents, outside: res.eventsOutsideVideo });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Couldn't sync this video. Try again.");
    }
  }

  function describeEvent(event: Event): string {
    const who = event.player ? `#${event.player.jerseyNumber} ${event.player.lastName}` : 'your team';
    return `${event.eventType.toLowerCase().replace(/_/g, ' ')} by ${who}, set ${event.setNumber}`;
  }

  return (
    <div className="rounded-lg border border-navy-600/20 bg-navy-100/40 p-4 space-y-3">
      <div>
        <h4 className="font-display text-sm font-semibold text-navy-700">
          {alreadySynced ? 'Match sync' : 'Sync to match'}
        </h4>
        <p className="text-xs text-grey-600 mt-1">
          Scrub to the first rally, then mark it — we&apos;ll match every tracked event to the video.
        </p>
      </div>

      {firstEvent ? (
        <p className="text-xs text-grey-900">
          <span className="text-grey-600">Look for:</span>{' '}
          <span className="font-semibold">{describeEvent(firstEvent)}</span>
        </p>
      ) : (
        <p className="text-xs text-grey-600 italic">
          No tracked events on this match yet — track a match first, then sync the video to it.
        </p>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          className="btn-secondary text-sm"
          disabled={!firstEvent || calibrate.isPending}
          onClick={markMoment}
        >
          {calibrate.isPending ? 'Syncing…' : alreadySynced ? 'Re-sync from here' : 'Mark this moment'}
        </button>

        {alreadySynced && !result && (
          <span className="text-xs text-success-strong">Synced.</span>
        )}
      </div>

      {result && (
        <div className="space-y-2">
          <p className="text-xs text-success-strong">
            Synced — {result.matched} event{result.matched === 1 ? '' : 's'} matched to this video
            {result.outside > 0 && `, ${result.outside} fell outside it`}.
          </p>
          {/* Re-syncing moves the anchor, so ranges computed from the old one no
              longer point at the right moments. Manual clips are unaffected. */}
          <p className="text-xs text-grey-600">
            Any clips generated before this sync now point at the wrong moments.{' '}
            <button
              className="underline hover:text-navy-700 disabled:opacity-50"
              disabled={clearGenerated.isPending}
              onClick={() => clearGenerated.mutate()}
            >
              {clearGenerated.isPending ? 'Clearing…' : 'Clear generated clips'}
            </button>{' '}
            then generate again. Clips you made by hand are kept.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-error-strong">{error}</p>}
    </div>
  );
}
