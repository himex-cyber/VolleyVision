# Video storage adapters

> **This adapter now serves only `source: UPLOAD`.** YouTube is the primary
> video source and never touches this folder — a linked video has no storage key,
> so there is nothing to presign, `head`, sign or delete. Upload is the
> private-storage option for clubs that cannot put footage on YouTube at all.
> See `docs/design/video-sources-decision.md`.

Match video is the one subsystem whose bytes never touch the API. Netlify
Functions cap a request payload at ~6 MB, so a match recording physically
cannot pass through an endpoint — the browser uploads straight to the storage
vendor using a short-lived presigned URL, and the API only issues that URL and
records what happened.

The vendor is not chosen yet. Everything vendor-specific lives behind
`VideoStorageProvider` in `types.ts`, so the decision is one env var plus one
file in this folder. See `docs/design/video-storage-decision.md` for the
comparison and the constraints that forced this shape.

## The interface

```ts
interface VideoStorageProvider {
  readonly name: string;
  createPresignedUpload(input: { storageKey; contentType; maxSizeBytes }): Promise<PresignedUpload>;
  getPlaybackSource(storageKey): Promise<PlaybackSource>;
  delete(storageKey): Promise<void>;
  head(storageKey): Promise<StorageObjectHead>;
}
```

| Method                  | Called by                         | Contract |
| ----------------------- | --------------------------------- | -------- |
| `createPresignedUpload` | `POST /matches/:id/videos/upload-intent`, `POST /videos/:id/refresh-upload` | Return somewhere the browser can send bytes without an app credential. Short-lived. |
| `head`                  | `POST /videos/:id/complete`       | The **only** proof an upload finished. Must report the object's real size — the size declared at intent is a client claim. `exists: false` for a missing object; throw for a transport failure, so a network blip is never recorded as a failed upload. |
| `getPlaybackSource`     | `GET /videos/:id/playback`        | Signed URL plus `kind`. `'file'` for a raw MP4/WebM, `'hls'` for an adaptive manifest — the frontend already branches on this. |
| `delete`                | `DELETE /videos/:id`, oversize cleanup | Must **throw** on failure. `deleteVideo` keeps the DB row when this fails, so bytes are never silently orphaned. |
| `uploadProxyHandler?`   | `ALL /videos/upload-tus/*`        | **Optional.** An Express handler proxying resumable-upload traffic, for providers whose upload protocol needs a server-held credential. Leave it undefined if your provider issues browser-safe upload URLs — see below. |

### `uploadProxyHandler` — optional, and better left undefined

Supabase sets it because its resumable upload requires an `Authorization`
header carrying the service-role key, which cannot go to a browser. R2, Stream
and Mux would leave it undefined: they issue scoped, single-use upload URLs the
browser can hold safely, so no proxy is needed.

**Needing no proxy is the better shape.** A proxy puts upload bytes back
through the API — the exact thing the presigned architecture exists to avoid,
and the reason Supabase is unusable on Netlify (below). Treat a provider that
requires one as carrying a known limitation, not as the norm.

The route resolves this from the provider **per request**, never at module
load — `getVideoStorageProvider()` reads env lazily so the API boots fully
unconfigured. When it is undefined the route answers `501`, because nothing is
broken: that provider simply does not work this way.

## Two upload protocols

`PresignedUpload` is a discriminated union. Every provider states which
protocol it speaks, and the frontend branches on `protocol` — never on provider
name.

| | `protocol: 'http'` | `protocol: 'tus'` |
| --- | --- | --- |
| Shape | `uploadUrl` + `method` (+ optional `fields` for S3 POST policies) | `endpoint` + `metadata` + `chunkSizeBytes` |
| Resumable | No — a drop at 90% restarts at 0 | Yes, from the last committed offset |
| Good for | Small files, S3 POST-policy providers | Match footage; anything large or on a flaky connection |
| Client | `XMLHttpRequest` | `tus-js-client` |

`storageKey` and `expiresAt` are on both arms, so the controller reads them
without narrowing. Do not rename them.

**Supabase speaks `tus`.** Its standard single-request upload is only
documented as reliable to 6 MB; above that it requires TUS (or S3 multipart),
which reaches 50 GB. Chunks must be **exactly 6 MiB** — a vendor requirement,
not a tuning knob, enforced in `lib/tusUpload.ts`.

## The TUS proxy, and why it exists

TUS needs an `Authorization` header. For Supabase that is the service-role key,
which bypasses RLS on every bucket and table. Returning it in `headers` would
publish it to anyone who opens the network tab.

So `endpoint` is **relative** — `/videos/upload-tus`, this app's own proxy
(`supabaseTusProxy.ts`, exposed through the provider's `uploadProxyHandler`).
It injects the key server-side, streams bodies without buffering, rewrites the
TUS `Location` back onto itself, and authorizes every chunk against the video
row that owns the target object. `headers` comes back empty; the client
attaches its own app JWT.

The routing layer contains no vendor-specific code: it mounts the guards and
delegates to whatever `uploadProxyHandler` the configured provider exposes.
Adding R2, Stream or Mux is still a one-file change.

> ⚠️ **The proxy cannot work on Netlify Functions.** A chunk is 6 MB and a
> Netlify request payload caps at ~6 MB (~4.5 MB usable for binary). Every chunk
> fails. This is not solvable at this layer — it is why production needs a
> provider that issues browser-safe credentials directly (R2 presigned
> multipart, Cloudflare Stream, Mux direct upload), which return an **absolute**
> `endpoint` and need no proxy at all. A startup warning fires on this
> combination. Supabase remains fully usable for local and self-hosted runtimes.

## Upload flow

1. `POST /matches/:matchId/videos/upload-intent` — validates, creates the
   `PENDING` row, returns `PresignedUpload` (minus `storageKey`).
2. Browser sends the bytes: one request (`http`) or chunked and resumable
   (`tus`). Never through the API, except via the proxy described above.
3. `POST /videos/:videoId/complete` — `head()` confirms the object and its real
   size; only then does the row become `READY`.

`POST /videos/:videoId/refresh-upload` sits alongside step 2: it issues a fresh
credential for the *same* storage key while the row is still `PENDING`, so an
upload that outlives its token resumes instead of restarting. `409` for a
`READY` or `FAILED` row — re-crediting a finished upload would let it be
overwritten.

## Adding a provider

1. Write `myProvider.ts` exporting a factory that takes the two TTLs and
   returns a `VideoStorageProvider`. Read credentials **inside** the factory or
   the methods — never at module load. The video routes are imported
   unconditionally, and a throw at import time takes the whole API down.
2. Add a `case` to the switch in `index.ts`.
3. Add the env vars to `backend/.env.example`.
4. Set `VIDEO_STORAGE_PROVIDER=myprovider`.

Nothing else changes. Controllers, Prisma schema, and the frontend are already
vendor-agnostic; `Video.storageProvider` records which adapter wrote each object
so a switch does not strand existing rows against the wrong backend.

## Current state

| Provider   | File                  | Upload protocol | Status |
| ---------- | --------------------- | --------------- | ------ |
| `supabase` | `supabaseProvider.ts` | `tus` via proxy | Implemented. Private bucket + signed URLs, `kind: 'file'`. Not usable on Netlify — see above. |
| `none`     | `noopProvider.ts`     | —               | Default. Every method throws a clean 503 so the app boots with zero video config. |
| `r2`       | —                     | `http` (presigned multipart) | Not implemented. Needs an S3-compatible SDK. No proxy required. |
| `stream`   | —                     | `tus`, direct   | Not implemented. Would return `kind: 'hls'`. Issues browser-safe credentials, so no proxy. |
| `mux`      | —                     | `tus`, direct   | Not implemented. Would return `kind: 'hls'` plus `posterUrl`. No proxy. |

## Verifying a configuration

`npm run check:video` checks the live bucket: that it exists, is private, has a
file-size limit at least `VIDEO_MAX_SIZE_BYTES`, allows the MIME types the API
allows, and survives an upload → `head()` → sign → delete round-trip. Non-zero
exit on failure, so a deploy can gate on it.
