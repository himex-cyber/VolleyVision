import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
 * ⚠️  iOS SAFARI FULLSCREEN HAZARD — READ BEFORE BUILDING AN OVERLAY
 * ═══════════════════════════════════════════════════════════════════════════
 * iOS Safari can hand playback to the native fullscreen player instead of
 * keeping it inline. When it does, the video is no longer painted inside our
 * iframe's box, so anything we draw on top of that box — a future annotation
 * canvas, a shot-chart overlay, a drawing layer — is left behind on a page the
 * user can't see.
 *
 * `playsinline: 1` below reduces how often this happens. It does NOT eliminate
 * it: iOS still promotes to fullscreen on some versions, low-power mode, and
 * when the user taps the fullscreen control.
 *
 * This must be tested on a REAL iOS device before overlay work starts. Do not
 * assume the simulator or desktop Safari reproduces it — they don't.
 * Recorded deliberately as a known hazard for the annotation slice.
 * ═══════════════════════════════════════════════════════════════════════════ */

/*
 * A YouTube embed is a cross-origin iframe. Reading pixels out of it — frame
 * capture, canvas drawing, thumbnail extraction, downloading — is blocked by
 * the browser and by YouTube's terms. Anything visual has to sit ON TOP of the
 * iframe, never be read out of it.
 */

const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';

// ─── Ambient API surface ───────────────────────────────────────────────────────
// Hand-rolled instead of pulling @types/youtube: the API ships as a script tag,
// not a package, so a dependency would only buy types for calls we never make.

interface YTPlayer {
  destroy(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  loadVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  getCurrentTime(): number;
  getDuration(): number;
  pauseVideo(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, number>;
      events?: {
        onReady?: () => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// ─── Single-flight script loader ───────────────────────────────────────────────

/**
 * Module-scope promise, so every mount past the first — including StrictMode's
 * deliberate double-effect — awaits the same load instead of racing it.
 */
let apiPromise: Promise<YTNamespace> | null = null;

function loadIframeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve) => {
    // `YT` is defined early by the script but `YT.Player` only once it's ready,
    // so the constructor — not the namespace — is what proves the load finished.
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    // The API fires this global exactly once and only ever reads the latest
    // assignment. Chaining whatever was there keeps a foreign loader (an
    // index.html tag, an analytics embed) working instead of silently killing it.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT as YTNamespace);
    };

    // A tag may already be in flight from index.html or a prior bundle; injecting
    // a second one makes the API re-init and drop existing players.
    if (!document.querySelector(`script[src="${IFRAME_API_SRC}"]`)) {
      const script = document.createElement('script');
      script.src = IFRAME_API_SRC;
      document.head.appendChild(script);
    }
  });

  return apiPromise;
}

// ─── Error copy ────────────────────────────────────────────────────────────────

function describeError(code: number): string {
  switch (code) {
    // 100 removed/private, 101 and 150 embedding disabled by the owner. All
    // three are the owner's choice, not something the coach can fix here.
    case 100:
    case 101:
    case 150:
      return 'This video is no longer available. The owner may have removed it or made it private.';
    // 2 — the API rejected the video ID itself, so the link is wrong, not the video.
    case 2:
      return "That video link isn't valid. Check the YouTube link and try again.";
    // 5 — the HTML5 player failed; the video exists, this browser can't run it.
    case 5:
      return "This video can't play in this browser. Try another browser, or open it on YouTube.";
    default:
      return "Couldn't load this video. Check your connection and try again.";
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export interface YouTubePlayerHandle {
  seekTo(seconds: number): void;
  playRange(startSeconds: number, endSeconds: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  pause(): void;
}

interface Props {
  videoId: string;
  /** Fired once, with the first duration the API reports above zero. */
  onDurationKnown?: (seconds: number) => void;
  onError?: (code: number) => void;
  className?: string;
}

const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayer(
  { videoId, onDurationKnown, onError, className = '' },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [errorCode, setErrorCode] = useState<number | null>(null);

  // Held in refs so an inline arrow from the parent doesn't tear down and
  // rebuild the player on every render.
  const onDurationKnownRef = useRef(onDurationKnown);
  const onErrorRef = useRef(onError);
  onDurationKnownRef.current = onDurationKnown;
  onErrorRef.current = onError;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let durationPoll: number | null = null;
    const stopPolling = () => {
      if (durationPoll !== null) {
        clearInterval(durationPoll);
        durationPoll = null;
      }
    };

    setErrorCode(null);

    // The API REPLACES the element it's handed with an <iframe>. Give it a
    // throwaway child so React never has to reconcile a node swapped out from
    // under it — that's the classic removeChild crash on unmount.
    const host = document.createElement('div');
    host.className = 'h-full w-full';
    container.appendChild(host);

    loadIframeApi().then((YT) => {
      if (cancelled) return;

      playerRef.current = new YT.Player(host, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            // getDuration() answers 0 until metadata lands, and there's no event
            // for "metadata arrived". Poll, then stop — the parent persists this
            // value, so firing repeatedly would mean repeated writes.
            durationPoll = window.setInterval(() => {
              const duration = playerRef.current?.getDuration() ?? 0;
              if (duration <= 0) return;
              stopPolling();
              onDurationKnownRef.current?.(duration);
            }, 250);
          },
          onError: (event) => {
            stopPolling();
            setErrorCode(event.data);
            onErrorRef.current?.(event.data);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      stopPolling();
      playerRef.current?.destroy();
      playerRef.current = null;
      host.remove();
    };
  }, [videoId]);

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (seconds) => playerRef.current?.seekTo(seconds, true),
      playRange: (startSeconds, endSeconds) => {
        // OBJECT form on purpose. The argument-list overload —
        // loadVideoById(id, startSeconds, quality) — has no endSeconds slot, so
        // positional args play from the start point to the end of the video and
        // the range silently stops being a range. Do not "simplify" this.
        playerRef.current?.loadVideoById({ videoId, startSeconds, endSeconds });
      },
      getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
      getDuration: () => playerRef.current?.getDuration() ?? 0,
      pause: () => playerRef.current?.pauseVideo(),
    }),
    [videoId],
  );

  // The container stays mounted under the error message rather than being
  // swapped out for it: unmounting it mid-effect would leave destroy() cleaning
  // up an iframe React had already torn away.
  return (
    <div className={`relative aspect-video overflow-hidden rounded-lg bg-navy-900 ${className}`}>
      <div ref={containerRef} className="h-full w-full" />
      {errorCode !== null && (
        <div className="absolute inset-0 grid place-items-center border border-grey-200 bg-grey-50 px-4 text-center">
          <p className="max-w-sm text-sm text-grey-600">{describeError(errorCode)}</p>
        </div>
      )}
    </div>
  );
});

export { YouTubePlayer };
export default YouTubePlayer;
