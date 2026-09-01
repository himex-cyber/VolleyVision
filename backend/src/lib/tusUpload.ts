// Pure helpers for the TUS resumable-upload protocol (https://tus.io).
// No network, no DB — encoding rules and identifier parsing only, so the proxy
// route stays thin and the rules stay testable (tusUpload.test.ts).

/**
 * Supabase requires exactly this chunk size for resumable uploads. It is not a
 * tuning knob: the storage backend rejects other values outright. Do not
 * "optimize" it — it looks arbitrary precisely because it is a vendor
 * constraint rather than a performance choice.
 */
export const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;

/**
 * TUS protocol headers that must survive a proxy hop in either direction.
 * Anything not on this list is not part of the resumable handshake.
 */
export const TUS_PASSTHROUGH_HEADERS = [
  'tus-resumable',
  'tus-version',
  'tus-extension',
  'tus-max-size',
  'upload-length',
  'upload-offset',
  'upload-metadata',
  'upload-expires',
  'upload-defer-length',
  'location',
  'content-type',
  'content-length',
] as const;

// ─── Upload-Metadata ──────────────────────────────────────────────────────────

/**
 * `key1 <base64>,key2 <base64>` — the TUS Upload-Metadata encoding. Keys are
 * plain ASCII; values are base64 so they can contain commas and spaces.
 */
export function encodeTusMetadata(meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([k, v]) => `${k} ${Buffer.from(v, 'utf8').toString('base64')}`)
    .join(',');
}

/**
 * Inverse of encodeTusMetadata. Tolerates a valueless key (legal per spec) and
 * skips malformed pairs rather than throwing — this parses attacker-reachable
 * input, and the caller's job is to decide whether what came back is usable.
 */
export function decodeTusMetadata(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header?.trim()) return out;

  for (const pair of header.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const spaceAt = trimmed.indexOf(' ');
    if (spaceAt === -1) {
      out[trimmed] = '';
      continue;
    }
    const key = trimmed.slice(0, spaceAt);
    const raw = trimmed.slice(spaceAt + 1).trim();
    if (!key) continue;
    try {
      out[key] = Buffer.from(raw, 'base64').toString('utf8');
    } catch {
      // Undecodable value — omit the key rather than record a lie.
    }
  }
  return out;
}

/**
 * Supabase's resumable endpoint. Lives here rather than with the proxy because
 * resolveTusTargetUrl below is the thing that has to reason about it, and pure
 * logic in lib/ is what the test suite can reach.
 */
export const SUPABASE_RESUMABLE_PATH = '/storage/v1/upload/resumable';

// ─── Storage-key recovery ─────────────────────────────────────────────────────

/**
 * The exact shape buildStorageKey produces: `matches/{matchId}/{uuid}.{ext}`.
 * Anchored, and every segment is server-generated, so a match here means the
 * value really is one of our keys and not something a client invented.
 */
const STORAGE_KEY_RE = /^matches\/[A-Za-z0-9_-]+\/[0-9a-fA-F-]{36}\.(?:mp4|mov|webm)$/;

/** Anchored shape check — use before trusting a key parsed out of client input. */
export function isVideoStorageKey(value: string): boolean {
  return STORAGE_KEY_RE.test(value);
}

/** Unanchored twin, for digging a key out of a larger string. */
const EMBEDDED_STORAGE_KEY_RE = /matches\/[A-Za-z0-9_-]+\/[0-9a-fA-F-]{36}\.(?:mp4|mov|webm)/;

/**
 * Recover the storage key from a TUS upload id.
 *
 * After creation the client PATCHes to an opaque id rather than re-sending
 * metadata, but the proxy still has to authorize every chunk — so the id has to
 * yield the object it belongs to. Supabase's ids are base64 of a string
 * containing `bucketName/objectName/...`, so decode and extract.
 *
 * Returns null when nothing key-shaped is in there; the caller must treat that
 * as "refuse", never as "allow".
 */
export function storageKeyFromTusUploadId(uploadId: string): string | null {
  if (!uploadId) return null;

  const candidates = [uploadId, decodeBase64Loose(uploadId)].filter((v): v is string => !!v);
  for (const candidate of candidates) {
    const match = candidate.match(EMBEDDED_STORAGE_KEY_RE);
    if (match) return match[0];
  }
  return null;
}

/** base64 / base64url, tolerant of missing padding. Returns null if it isn't text. */
function decodeBase64Loose(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    // A base64 decode of non-base64 input yields mojibake, not an error.
    return decoded.includes('�') ? null : decoded;
  } catch {
    return null;
  }
}

// ─── Location rewriting ───────────────────────────────────────────────────────

/**
 * Point the client's next request back at our proxy instead of at the vendor.
 *
 * TUS creation answers with a `Location` for the client to PATCH. Upstream that
 * is an absolute vendor URL, and following it directly would fail (no
 * credential) — so the id is lifted out and re-hung under `proxyBase`.
 *
 * Returns null when there is no id to lift, which the caller must treat as a
 * failed handshake rather than passing the vendor URL through.
 */
export function rewriteTusLocation(location: string, proxyBase: string): string | null {
  if (!location) return null;
  const id = location.split('/upload/resumable/')[1] ?? extractTrailingId(location);
  if (!id) return null;
  return `${proxyBase.replace(/\/$/, '')}/${id}`;
}

/**
 * Last non-empty path segment, query string preserved.
 *
 * Parses as a URL first so the *path* is what gets split. Splitting the raw
 * string would pick the hostname out of `https://host/` and hand it back as an
 * upload id — a wrong answer that looks like a right one.
 */
function extractTrailingId(location: string): string | null {
  let pathname = location;
  let search = '';
  try {
    // Base makes relative locations parse too; the origin is then ignored.
    const url = new URL(location, 'http://placeholder.invalid');
    pathname = url.pathname;
    search = url.search;
  } catch {
    // Unparseable — fall back to splitting what we were given.
    const [rawPath, rawQuery] = location.split('?');
    pathname = rawPath;
    search = rawQuery ? `?${rawQuery}` : '';
  }

  const segment = pathname.split('/').filter(Boolean).pop();
  if (!segment) return null;
  return search ? `${segment}${search}` : segment;
}

/**
 * Storage key for an inbound TUS request. Creation (POST) carries
 * Upload-Metadata; every later request identifies itself by upload id only.
 */
export function storageKeyFromTusRequest(input: {
  metadataHeader?: string | null;
  uploadId?: string | null;
}): string | null {
  // When an upload id is present it is the ONLY acceptable source, because it —
  // not the metadata header — is what determines the upstream path the proxy
  // writes to. Reading Upload-Metadata here as well would let a caller present a
  // storage key they legitimately own while pointing the id somewhere else, and
  // the guard would authorize a request it had not actually inspected.
  if (input.uploadId) {
    const fromId = storageKeyFromTusUploadId(input.uploadId);
    return fromId && isVideoStorageKey(fromId) ? fromId : null;
  }

  // Creation only: there is no id yet, so metadata is all there is.
  const fromMetadata = input.metadataHeader ? decodeTusMetadata(input.metadataHeader).objectName : undefined;
  return fromMetadata && isVideoStorageKey(fromMetadata) ? fromMetadata : null;
}

/**
 * Upstream URL for a TUS request, or null when the id would escape the
 * resumable prefix.
 *
 * The id reaches us as a URL path segment and Express percent-decodes it before
 * we see it, so `..%2F..%2F` arrives as real dot-segments — which the URL parser
 * then resolves away. Concatenating it into the target would let any caller aim
 * a service-role-credentialed request at any path on the Supabase project.
 *
 * The check is on the RESOLVED url rather than on the id's character set: a
 * legitimate Supabase upload id can itself contain slashes
 * (`match-videos/matches/<id>/<uuid>.mp4/1`), so a single-segment rule would
 * break real uploads. Resolving first and then asserting the result is still
 * under the resumable prefix closes all three escapes at once — dot segments,
 * protocol-relative `//host`, and a fully absolute URL.
 */
export function resolveTusTargetUrl(supabaseUrl: string, uploadId: string): URL | null {
  let base: URL;
  try {
    base = new URL(`${supabaseUrl.replace(/\/$/, '')}${SUPABASE_RESUMABLE_PATH}/`);
  } catch {
    return null;
  }
  // No id: this is the creation/capability request against the collection
  // itself. The trailing slash only exists so relative resolution below treats
  // the prefix as a directory, so drop it again here.
  if (!uploadId) {
    const collection = new URL(base);
    collection.pathname = SUPABASE_RESUMABLE_PATH;
    return collection;
  }

  let target: URL;
  try {
    target = new URL(uploadId, base);
  } catch {
    return null;
  }

  if (target.origin !== base.origin) return null;
  if (!target.pathname.startsWith(base.pathname)) return null;
  return target;
}
