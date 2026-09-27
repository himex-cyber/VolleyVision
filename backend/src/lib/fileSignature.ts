// Attachment byte-sniffing — the client-supplied multipart Content-Type is an
// attacker-chosen label, not a fact. Before anything is uploaded to Storage
// we check the leading bytes actually match what was declared, so a renamed
// executable can't ride in under an allowed MIME type and later get served
// back out through a signed URL wearing that type.

import { AppError } from '../middleware/errorHandler';

/** Canonical family a buffer's leading bytes identify, or null when there is no known signature. */
export type SniffedType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'application/pdf'
  | 'application/zip' // OOXML container (docx/xlsx/pptx)
  | 'application/x-ole-storage' // legacy Office container (doc/xls/ppt)
  | null;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/** Inspect the leading bytes of a buffer and identify its container family. */
export function sniffMimeType(buffer: Buffer): SniffedType {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('latin1');
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
      (buffer[2] === 0x05 && buffer[3] === 0x06) ||
      (buffer[2] === 0x07 && buffer[3] === 0x08))
  ) {
    return 'application/zip';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  ) {
    return 'application/x-ole-storage';
  }
  return null;
}

const EXACT_MATCH_MIME = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
const OOXML_MIME = new Set<string>([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const LEGACY_OFFICE_MIME = new Set<string>(['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint']);
const TEXT_MIME = new Set<string>(['text/plain', 'text/csv']);
const TEXT_SNIFF_WINDOW = 4096;

/**
 * Decide the content type to actually store, verifying the declared MIME
 * type against the buffer's real bytes. Throws AppError(400) when they
 * disagree.
 *
 * The message is deliberately self-contained: this runs deep inside the upload
 * path and no caller wraps it, so it has to read as a complete sentence on its
 * own. It also stays vague about *what* the bytes really were — an attacker
 * probing the allow-list learns nothing from it.
 */
export function resolveUploadContentType(declaredMime: string, buffer: Buffer): string {
  const sniffed = sniffMimeType(buffer);

  if (EXACT_MATCH_MIME.has(declaredMime)) {
    if (sniffed !== declaredMime) throw mismatch();
    // Sniffed, not declared: the bytes are the authority for these types.
    return sniffed;
  }

  if (OOXML_MIME.has(declaredMime)) {
    if (sniffed !== 'application/zip') throw mismatch();
    // docx/xlsx/pptx are all ZIP containers at the byte level, so the sniff
    // can only confirm "this is a zip" — it can't tell a docx from an xlsx.
    // declared is returned here as a refinement of a byte-verified container,
    // not an unchecked client claim: serving a .docx back out as
    // application/zip would break every download of it.
    return declaredMime;
  }

  if (LEGACY_OFFICE_MIME.has(declaredMime)) {
    if (sniffed !== 'application/x-ole-storage') throw mismatch();
    // Same reasoning as OOXML above: OLE is a shared container for legacy
    // doc/xls/ppt, so declared refines a byte-verified container.
    return declaredMime;
  }

  if (TEXT_MIME.has(declaredMime)) {
    if (sniffed !== null) throw mismatch();
    const window = buffer.subarray(0, TEXT_SNIFF_WINDOW);
    if (window.includes(0x00)) throw mismatch();
    return declaredMime;
  }

  // Unreachable in practice — assertAcceptable rejects unlisted types before
  // this is ever called — but it must fail closed if that order ever changes.
  throw new AppError(400, 'That file type is not supported.');
}

function mismatch(): AppError {
  return new AppError(
    400,
    "That file's contents don't match its file type. It may be corrupted, or renamed from another format.",
  );
}

/**
 * Canonical file extension for a byte-verified content type, or '' when the
 * type has none mapped.
 *
 * Storage keys take their extension from here, never from the uploader's
 * filename: the filename is attacker-chosen, so a PDF uploaded as `evil.png`
 * used to produce a key ending `.png` and get served inline. Every value
 * resolveUploadContentType can return is listed; anything else falls through to
 * '' — an extensionless key, which isInlineRenderableKey treats as not inline,
 * so a type added to the allow-list without an entry here fails closed.
 */
const EXTENSION_BY_CONTENT_TYPE = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
  ['application/msword', '.doc'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.ms-powerpoint', '.ppt'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
]);

export function storageExtensionFor(contentType: string): string {
  return EXTENSION_BY_CONTENT_TYPE.get(contentType) ?? '';
}

/**
 * True only when the storage key's extension is an image extension. Callers use
 * it to pick between an inline signed URL and one carrying `?download`.
 *
 * `download` is a query parameter on the signed URL, and the signature covers
 * the path and expiry, not the query string — a recipient can strip it and get
 * the object inline. So this is a UX hint about how the browser will present
 * the file, not an enforceable Content-Disposition and not a security control.
 * What keeps a mislabelled file from being served under a dangerous type is
 * resolveUploadContentType, which pins the stored Content-Type to the bytes.
 *
 * The extension it reads is a fact derived from those bytes: key builders
 * append storageExtensionFor(verified type) rather than the uploader's own
 * extension.
 *
 * ponytail: keys written before that change carry whatever extension the
 * uploader chose, so those rows keep the old, occasionally wrong answer — they
 * still resolve to a boolean and never throw. Upgrade path if the legacy rows
 * ever matter: store the resolved content type on the attachment row and key
 * off that instead.
 */
export function isInlineRenderableKey(storagePath: string): boolean {
  const match = /\.[^./]+$/.exec(storagePath);
  if (!match) return false;
  return IMAGE_EXTENSIONS.has(match[0].toLowerCase());
}
