// Same-origin TUS proxy.
//
// WHY THIS EXISTS
// The TUS endpoint needs an `Authorization` header, and for Supabase that is
// the service-role key. Returning it to the browser in the upload intent would
// hand every logged-in user full admin access to every bucket and every table
// with RLS bypassed — readable straight off the network tab. So the browser
// talks to this app, and this app talks to Supabase with the key attached
// server-side. The key never crosses the origin boundary.
//
// ⚠️ NOT VIABLE ON NETLIFY FUNCTIONS
// TUS chunks are exactly 6 MB (a Supabase requirement, not a choice) and a
// Netlify Function caps a request payload at ~6 MB — about 4.5 MB usable for
// binary once base64 overhead is counted. Every chunk through this proxy on
// Netlify will fail. This is honestly unsolvable at this layer: the fix is a
// provider that issues browser-safe upload credentials so no proxy is needed
// (Cloudflare R2 presigned multipart, Cloudflare Stream, or Mux direct upload).
// A startup warning fires when this combination is configured — see
// warnIfProxyUnsupported() below and docs/design/video-storage-decision.md.
//
// Useful and correct on any other runtime: local development, a container, a
// VM, or any host without a small request cap.

import http from 'node:http';
import https from 'node:https';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/errorHandler';
import { TUS_PASSTHROUGH_HEADERS, resolveTusTargetUrl, rewriteTusLocation } from '../../lib/tusUpload';

/**
 * Path of the app's TUS proxy, relative to the API base.
 *
 * Defined here rather than in supabaseProvider so the dependency runs one way:
 * the provider imports its proxy, and the proxy imports nothing back. The
 * reverse arrangement closed a cycle between the two files.
 */
export const TUS_PROXY_PATH = '/videos/upload-tus';

/**
 * Supabase's resumable endpoint, which the proxy — and only the proxy — talks to.
 * Defined in lib/tusUpload alongside resolveTusTargetUrl (the code that has to
 * reason about it, and that the pure test suite can reach); re-exported here
 * because this module has always been its public address.
 */
export { SUPABASE_RESUMABLE_PATH } from '../../lib/tusUpload';

/** Client headers that must never be forwarded upstream. */
const STRIPPED_REQUEST_HEADERS = new Set(['host', 'cookie', 'authorization', 'connection']);

/**
 * Streams a TUS request through to Supabase. Request and response bodies are
 * piped, never buffered — a 6 MB chunk held in memory per concurrent upload is
 * how a function runs out of heap.
 */
export function supabaseTusProxy(req: Request, res: Response, next: NextFunction): void {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    next(new AppError(503, 'Video storage is not configured.'));
    return;
  }

  // Express 4 wildcard: params[0] is everything after the mount path, already
  // percent-decoded — so it can carry `../` and must never be concatenated into
  // a URL that will be sent with the service-role key. resolveTusTargetUrl
  // resolves it and refuses anything that lands outside the resumable prefix.
  const uploadId = (req.params[0] ?? '').replace(/^\/+/, '');
  const target = resolveTusTargetUrl(supabaseUrl, uploadId);
  if (!target) {
    next(new AppError(400, 'Invalid upload id.'));
    return;
  }

  const headers: Record<string, string> = {
    // The one header the browser must never have been able to supply.
    authorization: `Bearer ${serviceKey}`,
    'x-upsert': 'false',
  };
  for (const name of TUS_PASSTHROUGH_HEADERS) {
    if (name === 'location') continue; // response-only
    const value = req.headers[name];
    if (typeof value === 'string' && !STRIPPED_REQUEST_HEADERS.has(name)) headers[name] = value;
  }

  const proxyBase = `${req.baseUrl}${TUS_PROXY_PATH}`;
  const client = target.protocol === 'http:' ? http : https;

  const upstream = client.request(
    target,
    { method: req.method, headers },
    (upstreamRes) => {
      for (const name of TUS_PASSTHROUGH_HEADERS) {
        const value = upstreamRes.headers[name];
        if (typeof value !== 'string') continue;

        if (name === 'location') {
          const rewritten = rewriteTusLocation(value, proxyBase);
          // No id to lift means the handshake did not produce a usable upload.
          // Passing the vendor URL through would send the browser somewhere it
          // cannot authenticate, so drop the header and let the client fail
          // on the missing Location instead.
          if (rewritten) res.setHeader('location', rewritten);
          continue;
        }
        res.setHeader(name, value);
      }

      res.status(upstreamRes.statusCode ?? 502);
      upstreamRes.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    console.error('TUS proxy upstream error:', err);
    if (!res.headersSent) next(new AppError(502, "Couldn't reach video storage. Please try again."));
    else res.end();
  });

  // Client hung up mid-chunk — abandon the upstream request rather than leaking a socket.
  req.on('aborted', () => upstream.destroy());

  req.pipe(upstream);
}

/**
 * Boot-time warning for the one configuration that cannot work. Warns, never
 * throws: an unusable upload path must not stop the API from serving auth,
 * matches, analytics and chat.
 */
export function warnIfProxyUnsupported(): void {
  if (process.env.VIDEO_STORAGE_PROVIDER?.trim().toLowerCase() !== 'supabase') return;
  if (!process.env.NETLIFY) return;

  console.warn(
    '\n⚠️  VIDEO_STORAGE_PROVIDER=supabase on a Netlify runtime.\n' +
      '   Supabase resumable uploads use 6 MB chunks and must be proxied through this API to keep the\n' +
      '   service-role key server-side. Netlify Functions cap a request payload at ~6 MB (~4.5 MB for\n' +
      '   binary), so every chunk will fail. Video uploads will NOT work on this deployment.\n' +
      '   Production needs a provider that issues browser-safe upload credentials: Cloudflare R2\n' +
      '   (presigned multipart), Cloudflare Stream, or Mux direct upload.\n' +
      '   See docs/design/video-storage-decision.md.\n',
  );
}
