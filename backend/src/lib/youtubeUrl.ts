// Pure parsing for coach-pasted YouTube links. No network, no DB.
//
// This is a trust boundary: the input is whatever a user pasted, and whatever
// comes out is embedded in an iframe. So the host is checked against an
// allow-list via the URL parser rather than pattern-matched out of the raw
// string — a regex over the whole input happily accepts
// `https://youtube.com.evil.com/watch?v=...`, where the real host is evil.com.

/** Hosts YouTube actually serves from. Exact matches only — no suffix matching. */
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
]);

/** A YouTube id is exactly 11 chars of the URL-safe base64 alphabet. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Path prefixes that carry the id as the next segment. */
const ID_BEARING_PREFIXES = ['embed', 'shorts', 'v', 'live'];

/**
 * Extract the 11-character video id from any common YouTube link, or null.
 *
 * Accepts: /watch?v=ID (with any extra params), youtu.be/ID, /embed/ID,
 * /shorts/ID, /live/ID, /v/ID, with or without www/m/music, http or https, and
 * a bare 11-character id.
 *
 * Returns null — never throws — for anything else, including links to other
 * domains and lookalike hosts.
 */
export function parseYouTubeVideoId(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A bare id, which is what a coach copying from the URL bar sometimes pastes.
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;

  // Protocol-relative and scheme-less forms still need to parse as a URL so the
  // host is checked properly, rather than being pattern-matched.
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/\//, '')}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  // Exact host match. `endsWith('youtube.com')` would accept evil-youtube.com.
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;

  // /watch?v=ID — the canonical form. Extra params (&t=, &list=) are ignored.
  const queryId = url.searchParams.get('v');
  if (queryId && VIDEO_ID_RE.test(queryId)) return queryId;

  const segments = url.pathname.split('/').filter(Boolean);

  // youtu.be/ID — the id is the whole path.
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    const candidate = segments[0];
    return candidate && VIDEO_ID_RE.test(candidate) ? candidate : null;
  }

  // /embed/ID, /shorts/ID, /live/ID, /v/ID
  if (segments.length >= 2 && ID_BEARING_PREFIXES.includes(segments[0].toLowerCase())) {
    const candidate = segments[1];
    return VIDEO_ID_RE.test(candidate) ? candidate : null;
  }

  return null;
}

/** True when `value` is exactly a well-formed video id. */
export function isYouTubeVideoId(value: string): boolean {
  return typeof value === 'string' && VIDEO_ID_RE.test(value);
}

/**
 * oEmbed URL for an existence/embeddability check. No API key needed.
 * Built from the parsed id, never from the user's original string, so nothing
 * user-controlled reaches the outbound request.
 */
export function youtubeOEmbedUrl(videoId: string): string {
  const target = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
  return `https://www.youtube.com/oembed?url=${target}&format=json`;
}

/** Canonical watch URL. For display/debug only — never rendered as a link. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
