import type { RequestHandler } from 'express';

// The contract every video storage vendor implements. Controllers, services
// and the frontend only ever see these shapes — swapping Supabase for R2,
// Cloudflare Stream or Mux is one env var plus one file in this folder.
//
// See README.md for how to add a provider, and
// docs/design/video-storage-decision.md for why the decision is deferred.

/**
 * How the browser is to deliver the bytes. A discriminated union rather than a
 * single shape, because the two protocols are genuinely different transactions
 * and the frontend must branch on data — never on provider name.
 *
 * `storageKey` and `expiresAt` are common to both arms on purpose: the
 * controller and the DB layer read them without narrowing.
 */
export type PresignedUpload = HttpPresignedUpload | TusPresignedUpload;

/**
 * One request, one shot. Fine for small files and for providers whose upload
 * is an S3 POST policy. Cannot resume: a connection drop restarts from zero,
 * which is why it is not the path for match footage.
 */
export interface HttpPresignedUpload {
  protocol: 'http';
  /** Where the browser PUT/POSTs the bytes. Short-lived, single-use. */
  uploadUrl: string;
  method: 'PUT' | 'POST';
  headers?: Record<string, string>;
  /** For multipart/form-data providers (S3 POST policies); unused by PUT providers. */
  fields?: Record<string, string>;
  /** Provider-side identifier we persist. Server-side only — never sent raw to a client. */
  storageKey: string;
  expiresAt: Date;
}

/**
 * Resumable, chunked (https://tus.io). The client negotiates against an
 * endpoint rather than firing a single request, so an interrupted upload picks
 * up at the last committed offset instead of starting again.
 */
export interface TusPresignedUpload {
  protocol: 'tus';
  /**
   * TUS server endpoint. Absolute for a vendor that can issue browser-safe
   * credentials; relative to the API base when the request must be proxied
   * through this app to keep a server-only key server-only.
   */
  endpoint: string;
  /**
   * Auth/signature headers the browser should send. MUST NOT carry any
   * server-only credential — see the proxy note in README.md. An empty object
   * is correct for a same-origin proxy, where the app's own JWT is what
   * authorizes the request.
   */
  headers: Record<string, string>;
  /** TUS Upload-Metadata entries: bucketName, objectName, contentType, cacheControl. */
  metadata: Record<string, string>;
  chunkSizeBytes: number;
  /** Provider-side identifier we persist. Server-side only — never sent raw to a client. */
  storageKey: string;
  expiresAt: Date;
}

export interface PlaybackSource {
  /** Signed playback URL. */
  url: string;
  /** 'file' = direct MP4/WebM, 'hls' = adaptive manifest. */
  kind: 'file' | 'hls';
  expiresAt: Date;
  posterUrl?: string;
}

/** What the provider really knows about an object, as opposed to what a client claims. */
export interface StorageObjectHead {
  exists: boolean;
  sizeBytes: number | null;
  contentType: string | null;
}

export interface VideoStorageProvider {
  /** Persisted on Video.storageProvider so a later vendor switch can tell keys apart. */
  readonly name: string;

  /**
   * Express handler proxying resumable-upload traffic, for providers whose
   * upload protocol requires a server-held credential.
   *
   * Undefined for providers that issue browser-safe direct-upload URLs (R2
   * presigned, Cloudflare Stream, Mux) — those need no proxy at all, and that
   * is the better shape: a proxy puts upload bytes back through the API, which
   * is the constraint the presigned architecture exists to avoid.
   *
   * Optional on purpose. The routing layer resolves this from the provider at
   * request time rather than importing a specific adapter, so adding a vendor
   * stays a one-file change.
   */
  uploadProxyHandler?: RequestHandler;

  createPresignedUpload(input: {
    storageKey: string;
    contentType: string;
    maxSizeBytes: number;
  }): Promise<PresignedUpload>;

  getPlaybackSource(storageKey: string): Promise<PlaybackSource>;

  /** Must throw on failure — a silent failure here orphans bytes. */
  delete(storageKey: string): Promise<void>;

  /**
   * Confirms the object actually exists and returns its real size. Used to
   * verify the client completed the upload and did not lie about size.
   */
  head(storageKey: string): Promise<StorageObjectHead>;
}
