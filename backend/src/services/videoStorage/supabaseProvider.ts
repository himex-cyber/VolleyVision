// Supabase Storage adapter — the one concrete provider today.
//
// Reuses the lazy client accessor and private-bucket / signed-URL conventions
// established by chatStorage.service.ts. Nothing outside this file knows that
// Supabase is involved.
//
// Bucket setup (once, in the Supabase dashboard):
//   - create the bucket named by VIDEO_STORAGE_BUCKET (default `match-videos`)
//   - keep it PRIVATE — playback goes through short-lived signed URLs
//   - raise the bucket file-size limit to at least VIDEO_MAX_SIZE_BYTES, since
//     the bucket cap, not this code, is what actually stops an oversize PUT

import { getSupabaseClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';
import { TUS_CHUNK_SIZE_BYTES } from '../../lib/tusUpload';
// One-way edge: this provider depends on its proxy, never the reverse. The two
// path constants live with the proxy for that reason — defining them here and
// importing the handler would close a cycle between the pair.
import { supabaseTusProxy, TUS_PROXY_PATH } from './supabaseTusProxy';
import type { PlaybackSource, PresignedUpload, StorageObjectHead, VideoStorageProvider } from './types';

/** Read at call time, not module load — see the lazy-init note in lib/supabase.ts. */
function bucketName(): string {
  return process.env.VIDEO_STORAGE_BUCKET || 'match-videos';
}

function bucket() {
  return getSupabaseClient().storage.from(bucketName());
}

/**
 * Supabase issues signed upload tokens with a fixed server-side lifetime
 * (currently 2 hours) that the API cannot shorten. VIDEO_UPLOAD_URL_TTL_SECONDS
 * therefore only narrows what we *report* as expiresAt — it can bring the
 * client's deadline forward, never push it past what the token actually allows.
 */
const SUPABASE_UPLOAD_TOKEN_TTL_SECONDS = 2 * 60 * 60;

export function createSupabaseVideoProvider(uploadTtlSeconds: number, playbackTtlSeconds: number): VideoStorageProvider {
  return {
    name: 'supabase',

    // Supabase's resumable upload needs an Authorization header carrying the
    // service-role key, which must never reach a browser — so this provider
    // supplies a proxy and the routing layer just mounts whatever the provider
    // gives it. A vendor issuing browser-safe upload URLs leaves this undefined.
    uploadProxyHandler: supabaseTusProxy,

    async createPresignedUpload({ storageKey, contentType }): Promise<PresignedUpload> {
      // Resumable (TUS), not createSignedUploadUrl. Supabase documents the
      // standard single-request upload as reliable only to 6 MB; above that it
      // requires TUS or S3 multipart, which reach 50 GB. Match footage is
      // orders of magnitude past that line, and a non-resumable PUT that dies
      // at 90% has to start from zero.
      //
      // maxSizeBytes is part of the interface for providers that can bind a cap
      // into the signature (S3 POST policies). Supabase enforces it at the
      // bucket instead, so it is not used here — completeUpload's head() check
      // is what makes the cap non-optional regardless of provider.
      const ttl = Math.min(uploadTtlSeconds, SUPABASE_UPLOAD_TOKEN_TTL_SECONDS);
      return {
        protocol: 'tus',
        // The app's own proxy, NOT Supabase's endpoint. TUS needs an
        // Authorization header, and ours would be the service-role key —
        // handing that to a browser would grant full admin access to every
        // bucket and table with RLS bypassed. The proxy injects it server-side.
        // Relative: the frontend resolves it against the API base.
        endpoint: TUS_PROXY_PATH,
        // Deliberately empty. The proxy is same-origin and authorizes on the
        // app's own JWT, which the client attaches itself. Nothing secret is
        // ever placed here — see the non-negotiable in README.md.
        headers: {},
        metadata: {
          bucketName: bucketName(),
          objectName: storageKey,
          contentType,
          cacheControl: '3600',
        },
        chunkSizeBytes: TUS_CHUNK_SIZE_BYTES,
        storageKey,
        expiresAt: new Date(Date.now() + ttl * 1000),
      };
    },

    async getPlaybackSource(storageKey): Promise<PlaybackSource> {
      const { data, error } = await bucket().createSignedUrl(storageKey, playbackTtlSeconds);
      if (error || !data?.signedUrl) {
        console.error(`Supabase signed playback URL failed for ${storageKey}:`, error?.message);
        throw new AppError(502, "Couldn't generate a playback link for this video.");
      }
      // Raw file — Supabase Storage does no transcoding, so there is no manifest
      // to serve. A transcoding provider returns kind: 'hls' here instead.
      return {
        url: data.signedUrl,
        kind: 'file',
        expiresAt: new Date(Date.now() + playbackTtlSeconds * 1000),
      };
    },

    async delete(storageKey): Promise<void> {
      // Unlike chatStorage's fire-and-forget cleanup, this throws: deleteVideo
      // keeps the DB row when storage deletion fails, so the bytes stay
      // reachable rather than becoming an untracked orphan.
      const { error } = await bucket().remove([storageKey]);
      if (error) {
        console.error(`Supabase delete failed for ${storageKey}:`, error.message);
        throw new AppError(502, "Couldn't delete the video from storage. Nothing was removed — please try again.");
      }
    },

    async head(storageKey): Promise<StorageObjectHead> {
      const { data, error } = await bucket().info(storageKey);
      if (error) {
        // 400/404 from the info endpoint means "no such object" — a real answer,
        // and the one that fails the upload. Anything else (auth, network, 5xx)
        // is our problem, not the client's, and must not be recorded as FAILED.
        const status = (error as { status?: number }).status;
        if (status === 400 || status === 404) return { exists: false, sizeBytes: null, contentType: null };
        console.error(`Supabase head failed for ${storageKey}:`, error.message);
        throw new AppError(502, "Couldn't verify the uploaded video. Please try again.");
      }
      return {
        exists: true,
        sizeBytes: data.size ?? null,
        contentType: data.contentType ?? null,
      };
    },
  };
}
