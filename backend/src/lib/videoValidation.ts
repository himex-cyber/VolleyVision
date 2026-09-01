// Pure validation for match-video uploads. No DB, no network, no provider
// knowledge — this is the whole rule set the upload-intent endpoint applies
// before it will issue a presigned URL, kept here so it is testable
// (videoValidation.test.ts).
//
// The declared content type and size arrive from the browser and are therefore
// untrusted. They are checked here so an upload that would be rejected never
// gets a URL in the first place; the real size and type are re-read from the
// provider at completion (see videoStatus.ts).

import { randomUUID } from 'node:crypto';
import { AppError } from '../middleware/errorHandler';

// ─── Limits ───────────────────────────────────────────────────────────────────

/** Container formats a browser <video> can play back directly. */
export const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

/**
 * Extension is derived from the *content type*, never from the filename — a
 * filename is attacker-controlled and the storage key must not inherit it.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

/**
 * Fallback when VIDEO_MAX_SIZE_BYTES is unset.
 *
 * 50 MB because that is the per-file ceiling on a Supabase Free project, and it
 * cannot be raised on that plan. The default has to be a value that actually
 * works on the plan a fresh install is most likely running, otherwise the
 * mismatch only surfaces after a user has spent minutes pushing bytes.
 *
 * Raising this is a deliberate act, and it takes two changes, not one: this
 * value AND the storage bucket's own file-size limit. `npm run check:video`
 * verifies they agree.
 */
export const DEFAULT_MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB

/** Supabase Free's unraisable per-file cap. Used for the boot-time warning. */
export const SUPABASE_FREE_TIER_MAX_BYTES = 50 * 1024 * 1024;

// ─── Filename ─────────────────────────────────────────────────────────────────

/**
 * Whitelist a display filename to [A-Za-z0-9._-] after stripping any directory
 * component. Purely cosmetic — the storage key never contains this — but it
 * keeps `../../etc/passwd` out of the UI and out of Content-Disposition.
 */
export function sanitizeVideoFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_{2,}/g, '_').slice(0, 120);
  return safe || 'video';
}

/** Extension for an allowed content type. Throws for anything off the list. */
export function extensionForContentType(contentType: string): string {
  const ext = EXTENSION_BY_MIME[contentType];
  if (!ext) throw new AppError(400, `Unsupported video type: ${contentType}. Allowed: MP4, MOV, WebM.`);
  return ext;
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

/**
 * `matches/{matchId}/{uuid}.{ext}` — every segment is either a server-side id
 * or a fixed extension, so the key cannot be steered by client input. The
 * original filename lives in Video.filename for display.
 *
 * `id` defaults to a fresh UUID (the same uniqueness device chatStorage uses);
 * it is a parameter so the tests can pin it.
 */
export function buildStorageKey(matchId: string, contentType: string, id: string = randomUUID()): string {
  return `matches/${matchId}/${id}.${extensionForContentType(contentType)}`;
}

// ─── Intent validation ────────────────────────────────────────────────────────

export interface UploadIntentInput {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Validate an upload-intent body. Returns the normalized values to persist.
 * Throws AppError(400) with a user-facing message on anything unacceptable.
 */
export function validateUploadIntent(
  input: Partial<UploadIntentInput>,
  maxSizeBytes: number,
): { filename: string; contentType: string; sizeBytes: number } {
  const { filename, contentType, sizeBytes } = input;

  if (typeof filename !== 'string' || !filename.trim()) {
    throw new AppError(400, 'filename is required.');
  }
  if (typeof contentType !== 'string' || !ALLOWED_VIDEO_MIME.has(contentType)) {
    throw new AppError(400, `Unsupported video type: ${contentType ?? 'none'}. Allowed: MP4, MOV, WebM.`);
  }
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new AppError(400, 'sizeBytes must be a positive whole number of bytes.');
  }
  if (sizeBytes > maxSizeBytes) {
    throw new AppError(400, `That video is too large. Maximum size is ${formatMb(maxSizeBytes)}.`);
  }

  return { filename: sanitizeVideoFilename(filename), contentType, sizeBytes };
}

/** "500 MB" / "1.5 GB" — for size-limit messages. */
export function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${Math.round(mb)} MB`;
}
