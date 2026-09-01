import { useMemo, useRef, useState } from 'react';
import {
  useMatchVideos,
  useUploadVideo,
  useResumeUpload,
  useDeleteVideo,
  useVideoPlayback,
  useSetVideoDuration,
  useGenerateClips,
  useCreateClip,
  useEvents,
} from '../../hooks';
import type { Event, Video } from '../../types';
import YouTubePlayer, { type YouTubePlayerHandle } from '../video/YouTubePlayer';
import LinkYouTubeForm from '../video/LinkYouTubeForm';
import MatchSyncPanel from '../video/MatchSyncPanel';
import ClipList, { formatTimecode } from '../video/ClipList';

/**
 * The upload path is built and dormant. It only makes sense to offer when the
 * backend actually has a storage provider configured, and the frontend can't
 * read backend env — so it is gated on a build-time flag rather than a runtime
 * probe. Unset means hidden, which is the right default: YouTube is the
 * primary source and needs no infrastructure at all.
 */
const UPLOAD_ENABLED = import.meta.env.VITE_VIDEO_UPLOAD_ENABLED === 'true';

// ─── Uploaded-video player (signed URL) ───────────────────────────────────────

function UploadedVideoPlayer({ video, videoRef }: { video: Video; videoRef: React.RefObject<HTMLVideoElement> }) {
  const { data: source, isLoading, error } = useVideoPlayback(video.id);

  if (isLoading) {
    return <div className="aspect-video rounded-lg bg-navy-900 grid place-items-center text-sm text-navy-300">Loading video…</div>;
  }

  if (error || !source) {
    const status = (error as { response?: { status?: number } } | null)?.response?.status;
    const message =
      status === 410
        ? 'This recording was stored before the storage upgrade and is no longer available.'
        : status === 409
          ? "This video hasn't finished uploading yet."
          : "Couldn't load this video. Check your connection and try again.";
    return <div className="rounded-lg border border-grey-200 bg-grey-50 px-4 py-6 text-center text-sm text-grey-600">{message}</div>;
  }

  // 'hls' is an adaptive manifest. Safari/iOS play it from a plain src; every
  // other browser needs an HLS player attached. That attach is the only change
  // required when a transcoding provider is chosen.
  if (source.kind === 'hls' && !canPlayHlsNatively()) {
    return (
      <div className="rounded-lg border border-grey-200 bg-grey-50 px-4 py-6 text-center text-sm text-grey-600">
        This video needs an adaptive-streaming player, which this browser doesn&apos;t have built in.
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      controls
      playsInline
      poster={source.posterUrl}
      className="w-full rounded-lg bg-navy-900"
      src={source.url}
    />
  );
}

/** Safari/iOS only, today. Replace with an hls.js attach when a transcoding provider ships. */
function canPlayHlsNatively(): boolean {
  return document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
}

// ─── YouTube review surface ───────────────────────────────────────────────────

function YouTubeReview({ video, matchId, firstEvent }: { video: Video; matchId: string; firstEvent: Event | null }) {
  const player = useRef<YouTubePlayerHandle>(null);
  const setDuration = useSetVideoDuration(matchId);
  const generateClips = useGenerateClips(video.id);
  const createClip = useCreateClip(video.id);

  const [unavailable, setUnavailable] = useState(false);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const calibrated = !!video.recordingStartedAt;

  async function handleGenerate() {
    setError('');
    setNotice('');
    try {
      const res = await generateClips.mutateAsync(undefined);
      const parts = [`${res.created} clip${res.created === 1 ? '' : 's'} created`];
      if (res.eventsOutsideVideo > 0) parts.push(`${res.eventsOutsideVideo} events fell outside this video`);
      if (res.skippedExisting > 0) parts.push(`${res.skippedExisting} already had clips`);
      setNotice(`${parts.join(', ')}.`);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Couldn't generate clips. Try again.");
    }
  }

  async function handleMarkOut() {
    const current = Math.floor(player.current?.getCurrentTime() ?? 0);
    if (markIn === null) return;
    if (current <= markIn) {
      setError('Mark out has to come after mark in.');
      return;
    }
    setError('');
    try {
      await createClip.mutateAsync({ startSeconds: markIn, endSeconds: current });
      setMarkIn(null);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Couldn't save that clip. Try again.");
    }
  }

  return (
    <div className="space-y-4">
      {video.youtubeVideoId && (
        <YouTubePlayer
          ref={player}
          videoId={video.youtubeVideoId}
          // Fires once, when the player first knows the real length — it is what
          // lets clip generation clamp at the end of the footage.
          onDurationKnown={(seconds) =>
            setDuration.mutate({ videoId: video.id, durationSeconds: Math.floor(seconds) })
          }
          onError={() => setUnavailable(true)}
        />
      )}

      {/* The row is NOT deleted when this happens — the coach may re-link or
          restore the video on YouTube, and their clips are still worth keeping. */}
      {unavailable && (
        <p className="text-xs text-grey-600">
          If you&apos;ve changed the video on YouTube, re-link it here — your clips stay attached to this match.
        </p>
      )}

      <MatchSyncPanel video={video} firstEvent={firstEvent} player={player} matchId={matchId} />

      {/* Clip controls */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="btn-secondary text-sm"
            disabled={!calibrated || generateClips.isPending}
            onClick={handleGenerate}
            title={calibrated ? undefined : 'Sync this video to the match first — clips are placed using that anchor.'}
          >
            {generateClips.isPending ? 'Generating…' : 'Generate from tracked events'}
          </button>

          {markIn === null ? (
            <button
              className="btn-secondary text-sm"
              onClick={() => setMarkIn(Math.floor(player.current?.getCurrentTime() ?? 0))}
            >
              Mark in
            </button>
          ) : (
            <>
              <button className="btn-secondary text-sm" disabled={createClip.isPending} onClick={handleMarkOut}>
                Mark out
              </button>
              <span className="text-xs text-grey-600 tabular">in at {formatTimecode(markIn)}</span>
              <button className="text-xs text-grey-400 hover:text-navy-700" onClick={() => setMarkIn(null)}>
                Cancel
              </button>
            </>
          )}
        </div>

        {!calibrated && (
          <p className="text-xs text-grey-600">
            Generating clips needs the video synced to the match. You can still mark clips by hand.
          </p>
        )}
        {notice && <p className="text-xs text-success-strong">{notice}</p>}
        {error && <p className="text-xs text-error-strong">{error}</p>}

        <ClipList videoId={video.id} player={player} />
      </div>
    </div>
  );
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ video }: { video: Video }) {
  if (video.source === 'YOUTUBE') return <span className="badge badge-brand shrink-0">YouTube</span>;
  if (video.status === 'READY') return null;
  return video.status === 'PENDING' ? (
    <span className="badge badge-neutral shrink-0">Uploading</span>
  ) : (
    <span className="badge badge-error shrink-0">Failed</span>
  );
}

// ─── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  matchId: string;
}

export default function VideoPanel({ matchId }: Props) {
  const { data: videos, isLoading } = useMatchVideos(matchId, true);
  const { data: events } = useEvents(matchId);
  const uploadVideo = useUploadVideo(matchId);
  const resumeUpload = useResumeUpload(matchId);
  const deleteVideo = useDeleteVideo(matchId);

  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resumeTargetId = useRef<string | null>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);

  const FAILED_MESSAGE = "Upload didn't finish. Check your connection and try again.";

  /**
   * The anchor the coach is asked to find. Own-team only and earliest first,
   * matching how the server picks it — showing a different event than the one
   * calibration actually uses would make the sync silently wrong.
   */
  const firstEvent = useMemo<Event | null>(() => {
    if (!events?.length) return null;
    const own = events.filter((e) => !e.isOpponentEvent);
    if (own.length === 0) return null;
    return own.reduce((earliest, e) => (e.recordedAt < earliest.recordedAt ? e : earliest));
  }, [events]);

  // Keep the selected video in sync with refetched data, so calibrating updates
  // the panel below without the coach reselecting.
  const selected = selectedVideo ? videos?.find((v) => v.id === selectedVideo.id) ?? null : null;

  function describeError(err: any): string {
    return err?.response?.data?.error ?? err?.message ?? FAILED_MESSAGE;
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError('');
    setProgress(0);
    try {
      await uploadVideo.mutateAsync({ file, onProgress: setProgress });
    } catch (err: any) {
      setUploadError(describeError(err));
    } finally {
      setProgress(null);
    }
  }

  function startResume(videoId: string) {
    resumeTargetId.current = videoId;
    resumeInputRef.current?.click();
  }

  async function handleResumeFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const videoId = resumeTargetId.current;
    e.target.value = '';
    resumeTargetId.current = null;
    if (!file || !videoId) return;
    setUploadError('');
    setProgress(0);
    try {
      await resumeUpload.mutateAsync({ videoId, file, onProgress: setProgress });
    } catch (err: any) {
      setUploadError(describeError(err));
    } finally {
      setProgress(null);
    }
  }

  const uploading = uploadVideo.isPending || resumeUpload.isPending;

  return (
    <div className="space-y-5">
      {/* Primary path — paste a link. No bucket, no cost, no configuration. */}
      <LinkYouTubeForm matchId={matchId} />

      {/* Secondary path — private storage, only when the backend has a provider. */}
      {UPLOAD_ENABLED && (
        <details className="rounded-lg border border-grey-200 bg-grey-50 p-3">
          <summary className="text-xs text-grey-600 cursor-pointer">Or upload a file to private storage</summary>
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <label className={`btn-secondary text-sm ${uploading ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}>
                {uploading ? 'Uploading…' : 'Choose file'}
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
              </label>
              <span className="text-xs text-grey-600">MP4, MOV, WebM</span>
            </div>

            {progress !== null && (
              <div className="space-y-1">
                <div className="h-1.5 w-full rounded-full bg-grey-200 overflow-hidden">
                  <div className="h-full rounded-full bg-gold-500 transition-[width] duration-200" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-xs text-grey-600 tabular">
                  {progress < 100 ? `${progress}% uploaded` : 'Finishing up…'}
                </p>
              </div>
            )}

            {uploadError && <p className="text-xs text-error-strong">{uploadError}</p>}

            <input
              ref={resumeInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={handleResumeFileChange}
            />
          </div>
        </details>
      )}

      {/* Video list */}
      {isLoading ? (
        <p className="text-sm text-grey-600">Loading videos…</p>
      ) : !videos?.length ? (
        <div className="card p-6 text-center text-grey-600 text-sm">
          No video yet — paste a YouTube link to review this match.
        </div>
      ) : (
        <div className="space-y-1">
          {videos.map((v) => {
            const playable = v.source === 'YOUTUBE' || v.status === 'READY';
            const name = v.title ?? v.filename ?? 'Match video';
            return (
              <div
                key={v.id}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                  selected?.id === v.id ? 'bg-navy-100 border border-navy-600/30' : 'bg-grey-50 hover:bg-navy-100'
                } ${playable ? 'cursor-pointer' : 'cursor-default'}`}
                onClick={() => {
                  if (!playable) return;
                  setSelectedVideo(selected?.id === v.id ? null : v);
                }}
              >
                <span className={`text-sm flex-1 truncate ${playable ? 'text-grey-900' : 'text-grey-600'}`}>{name}</span>
                <StatusBadge video={v} />
                {v.source === 'YOUTUBE' && !v.recordingStartedAt && (
                  <span className="badge badge-neutral shrink-0">Not synced</span>
                )}
                {v.source === 'UPLOAD' && v.status === 'PENDING' && (
                  <button
                    className="btn-secondary text-xs px-2 py-1 shrink-0"
                    disabled={uploading}
                    onClick={(e) => { e.stopPropagation(); startResume(v.id); }}
                  >
                    Resume
                  </button>
                )}
                <span className="text-xs text-grey-600 shrink-0 tabular">
                  {new Date(v.uploadedAt).toLocaleDateString()}
                </span>
                <button
                  className="text-grey-400 hover:text-error-strong text-xs shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    const what = v.source === 'YOUTUBE'
                      ? `Unlink "${name}"? The video stays on YouTube; its clips are removed.`
                      : `Delete "${name}"? This cannot be undone.`;
                    if (confirm(what)) {
                      if (selected?.id === v.id) setSelectedVideo(null);
                      deleteVideo.mutate(v.id);
                    }
                  }}
                >
                  {v.source === 'YOUTUBE' ? 'Unlink' : 'Delete'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Review surface for whichever video is selected */}
      {selected && (
        <div className="card p-4 space-y-4">
          <h3 className="font-display text-base font-semibold text-navy-700 truncate">
            {selected.title ?? selected.filename ?? 'Match video'}
          </h3>
          {selected.source === 'YOUTUBE' ? (
            <YouTubeReview video={selected} matchId={matchId} firstEvent={firstEvent} />
          ) : (
            <UploadedVideoPlayer video={selected} videoRef={videoRef} />
          )}
        </div>
      )}
    </div>
  );
}
