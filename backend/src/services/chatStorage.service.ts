// Team Chat attachments — the single choke-point for all Supabase Storage
// access. Every byte in or out of the `team-chat` bucket goes through here:
// upload, signed-URL read, compensating delete. Limits are re-validated in
// this service even though the bucket enforces its own MIME/size caps
// (defense in depth — bucket settings can drift).

import { randomUUID } from 'node:crypto';
import { imageSize } from 'image-size';
import { AttachmentKind } from '@prisma/client';
import { getSupabaseClient } from '../lib/supabase';
import { AppError } from '../middleware/errorHandler';
import { resolveUploadContentType, isInlineRenderableKey } from '../lib/fileSignature';

const BUCKET = process.env.SUPABASE_CHAT_BUCKET || 'team-chat';

// ─── Limits (mirror the bucket-level allow-list) ─────────────────────────────

export const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// Conservative document allow-list — pdf, office, plain text/csv. Executables
// and scripts are rejected by omission.
export const FILE_MIME = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB (also the bucket cap)
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

// ─── Classification / validation ─────────────────────────────────────────────

/** IMAGE | FILE for the AttachmentKind enum; null = not an accepted type. */
export function classifyKind(mimeType: string): AttachmentKind | null {
  if (IMAGE_MIME.has(mimeType)) return AttachmentKind.IMAGE;
  if (FILE_MIME.has(mimeType)) return AttachmentKind.FILE;
  return null;
}

/**
 * Validate one incoming file and return its kind. Throws AppError(400) with a
 * user-facing message on unsupported type or oversize.
 */
export function assertAcceptable(file: { originalname: string; mimetype: string; size: number }): AttachmentKind {
  const kind = classifyKind(file.mimetype);
  if (!kind) {
    throw new AppError(400, `"${file.originalname}" is not a supported file type. Allowed: images (jpg, png, webp, gif), PDF, office documents, plain text, and CSV.`);
  }
  const cap = kind === AttachmentKind.IMAGE ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
  if (file.size > cap) {
    const capMb = Math.round(cap / (1024 * 1024));
    throw new AppError(400, `"${file.originalname}" is too large. Maximum size is ${capMb} MB for ${kind === AttachmentKind.IMAGE ? 'images' : 'files'}.`);
  }
  return kind;
}

/** Width/height for IMAGE attachments (stored to avoid layout shift); null if unreadable. */
export function imageDimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    const { width, height } = imageSize(buffer);
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

// ─── Object keys ──────────────────────────────────────────────────────────────

/** Whitelist to [A-Za-z0-9._-]; the original filename is stored separately for display. */
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_{2,}/g, '_').slice(0, 100);
  return safe || 'file';
}

/** `teams/{teamId}/channels/{channelId}/{messageId}/{uuid}-{safeName}` (uuid = key uniqueness). */
export function buildObjectKey(opts: {
  teamId: string;
  channelId: string;
  messageId: string;
  originalName: string;
}): string {
  return `teams/${opts.teamId}/channels/${opts.channelId}/${opts.messageId}/${randomUUID()}-${sanitizeFilename(opts.originalName)}`;
}

// ─── Storage operations ───────────────────────────────────────────────────────

export async function uploadAttachment(opts: { key: string; buffer: Buffer; mimeType: string }): Promise<string> {
  const contentType = resolveUploadContentType(opts.mimeType, opts.buffer);
  const { error } = await getSupabaseClient().storage
    .from(BUCKET)
    .upload(opts.key, opts.buffer, { contentType, upsert: false });
  if (error) {
    console.error(`Supabase upload failed for ${opts.key}:`, error.message);
    throw new AppError(502, 'File storage upload failed. Please try again.');
  }
  return opts.key;
}

/**
 * Batch-sign a page of attachments in one Storage call. Returns
 * storagePath → signedUrl, with null for any path that failed to sign —
 * a page of messages must never 500 because one attachment couldn't sign.
 *
 * Supabase's batch API applies one `options` set to the whole call, but
 * non-image attachments need `download: true` (forced download) while
 * images need the browser-renders-inline default — so the paths are split
 * by kind and signed in up to two calls, then merged back into one map.
 */
export async function signAttachmentUrls(paths: string[], ttlSeconds = 3600): Promise<Map<string, string | null>> {
  if (paths.length === 0) return new Map();
  const imagePaths = paths.filter((p) => isInlineRenderableKey(p));
  const filePaths = paths.filter((p) => !isInlineRenderableKey(p));

  const map = new Map<string, string | null>();
  const bucket = getSupabaseClient().storage.from(BUCKET);

  async function signGroup(group: string[], options?: { download: true }) {
    if (group.length === 0) return;
    const { data, error } = await bucket.createSignedUrls(group, ttlSeconds, options);
    if (error || !data) {
      console.error(`Supabase batch signing failed for ${group.length} path(s):`, error?.message);
      for (const p of group) map.set(p, null);
      return;
    }
    for (const entry of data) {
      if (entry.path) map.set(entry.path, entry.error ? null : entry.signedUrl);
    }
    for (const p of group) if (!map.has(p)) map.set(p, null);
  }

  await signGroup(imagePaths);
  await signGroup(filePaths, { download: true });
  return map;
}

/** Short-lived signed URL — the storagePath itself is never sent to clients. */
export async function signAttachmentUrl(storagePath: string, ttlSeconds = 3600): Promise<string> {
  const options = isInlineRenderableKey(storagePath) ? undefined : { download: true as const };
  const { data, error } = await getSupabaseClient().storage.from(BUCKET).createSignedUrl(storagePath, ttlSeconds, options);
  if (error || !data?.signedUrl) {
    console.error(`Supabase signed URL failed for ${storagePath}:`, error?.message);
    throw new AppError(502, 'Could not generate a download link for an attachment.');
  }
  return data.signedUrl;
}

/**
 * Compensating cleanup (e.g. DB write failed after upload). Cleanup must never
 * mask the original failure, so errors are logged, not thrown — an orphaned
 * object costs storage; a thrown cleanup error costs the real error message.
 */
export async function deleteObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await getSupabaseClient().storage.from(BUCKET).remove(paths);
    if (error) console.error(`Supabase cleanup failed for ${paths.length} object(s):`, error.message);
  } catch (err) {
    console.error('Supabase cleanup threw:', err);
  }
}
