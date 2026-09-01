// Provider registry + video storage config.
//
// Lazy by construction: nothing here reads env or builds a client at module
// load. The video routes are imported unconditionally by index.ts, and a
// storage misconfiguration must never take down auth, matches or analytics —
// that class of bug is exactly what the hardening pass fixed in lib/supabase.ts.
// An unconfigured or unknown provider resolves to the noop adapter, which fails
// at call time with a clean 503.

import type { VideoStorageProvider } from './types';
import { createSupabaseVideoProvider } from './supabaseProvider';
import { noopProvider } from './noopProvider';
import { DEFAULT_MAX_VIDEO_BYTES, SUPABASE_FREE_TIER_MAX_BYTES } from '../../lib/videoValidation';

export type { PlaybackSource, PresignedUpload, StorageObjectHead, VideoStorageProvider } from './types';

// ─── Config ───────────────────────────────────────────────────────────────────

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`${name}="${raw}" is not a positive integer; using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

/** Read per call so tests and scripts can change env without a module reset. */
export function videoStorageConfig() {
  return {
    maxSizeBytes: intEnv('VIDEO_MAX_SIZE_BYTES', DEFAULT_MAX_VIDEO_BYTES),
    uploadUrlTtlSeconds: intEnv('VIDEO_UPLOAD_URL_TTL_SECONDS', 60 * 60),
    playbackUrlTtlSeconds: intEnv('VIDEO_PLAYBACK_URL_TTL_SECONDS', 60 * 60),
  };
}

// ─── Registry ─────────────────────────────────────────────────────────────────

let provider: VideoStorageProvider | null = null;

/**
 * Memoized adapter selected by VIDEO_STORAGE_PROVIDER.
 * `supabase` is implemented; `r2` / `stream` / `mux` are documented in
 * README.md and deliberately unimplemented (see the decision doc).
 */
export function getVideoStorageProvider(): VideoStorageProvider {
  if (provider) return provider;

  const name = (process.env.VIDEO_STORAGE_PROVIDER || 'none').trim().toLowerCase();
  const cfg = videoStorageConfig();

  switch (name) {
    case 'supabase':
      provider = createSupabaseVideoProvider(cfg.uploadUrlTtlSeconds, cfg.playbackUrlTtlSeconds);
      break;
    case 'none':
      provider = noopProvider;
      break;
    default:
      console.error(
        `VIDEO_STORAGE_PROVIDER="${name}" has no adapter. Video endpoints will return 503. ` +
          'Implemented: supabase, none. See backend/src/services/videoStorage/README.md.',
      );
      provider = noopProvider;
  }

  return provider;
}

/** Test/script hook — forget the memoized adapter so a new env is picked up. */
export function resetVideoStorageProvider(): void {
  provider = null;
}

// ─── Boot-time coherence check ────────────────────────────────────────────────

/**
 * Report the effective upload ceiling at boot, and warn when it exceeds what a
 * Supabase Free project will accept.
 *
 * The app's limit and the bucket's limit are two separate settings, and only
 * the bucket's is enforced during the transfer. When the app allows more than
 * the bucket accepts, the rejection lands after the user has already uploaded —
 * the worst possible moment to discover a config mismatch. Warns, never throws:
 * `npm run check:video` is what proves the two agree against the live bucket.
 */
export function logVideoStorageConfig(): void {
  const name = (process.env.VIDEO_STORAGE_PROVIDER || 'none').trim().toLowerCase();
  if (name === 'none') return;

  const { maxSizeBytes } = videoStorageConfig();
  const mb = Math.round(maxSizeBytes / (1024 * 1024));
  console.log(
    `🎬 Video storage: provider="${name}", max upload ${mb} MB. ` +
      "The storage bucket's own file-size limit must be >= this value.",
  );

  if (maxSizeBytes > SUPABASE_FREE_TIER_MAX_BYTES) {
    console.warn(
      `⚠️  VIDEO_MAX_SIZE_BYTES is ${mb} MB, above the 50 MB per-file cap on a Supabase Free project ` +
        '(unraisable on that plan). Uploads over 50 MB will be rejected by the bucket mid-transfer ' +
        'unless this project is on a paid plan with a matching bucket limit. Run `npm run check:video` to verify.',
    );
  }
}
