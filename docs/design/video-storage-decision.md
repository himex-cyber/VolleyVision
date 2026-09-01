# Match video storage — architecture and deferred vendor decision

**Status:** architecture settled, vendor deferred.
**Scope:** match video upload, storage, and playback. Nothing else in the app
touches object storage this way; team-chat and feedback attachments are small
enough to keep flowing through the API.

---

## 1. Three constraints

These are not preferences. Each one eliminates a design that would otherwise be
the obvious choice, and together they leave exactly one shape.

### 1.1 There is no disk

The original implementation wrote uploads to `uploads/videos` via
`multer.diskStorage`. VolleyVision's API runs as a Netlify Function: an
ephemeral container where only `/tmp` is writable, nothing survives between
invocations, and concurrent invocations do not share a filesystem. An upload
written on one invocation is not there for the next one to read.

This was not a performance problem or an edge case. Every upload was lost and
every playback 404'd.

### 1.2 A match video cannot fit in a request — this is why uploads are presigned

**Netlify caps a function request payload at 6 MB**, and roughly 4.5 MB of that
is usable for binary content once base64 overhead is accounted for. The old
route advertised a 500 MB limit. A single set of volleyball footage is one to
three orders of magnitude over the cap.

No amount of chunking, streaming, or tuning changes this: the API is simply not
a path that video bytes can travel down. The bytes have to go from the browser
to the storage vendor directly, which means the browser needs a credential to
write to that vendor, which means a **short-lived presigned URL** issued by the
API.

Everything else about the upload flow follows from that one fact:

| Consequence | Why it is forced |
| --- | --- |
| Three-step upload (intent → direct PUT → complete) | The API is not in the data path, so it must be told separately when to expect an object and when to check for it. |
| `PENDING` / `READY` / `FAILED` lifecycle | A row exists from the moment a URL is issued, but nothing proves bytes arrived until the server looks. |
| Server-side `head()` verification | The client declares its own filename, type, and size. All three are claims. The provider's answer is the measurement. |
| Signed playback URLs, never proxied bytes | The 6 MB cap applies to responses too. |
| An orphan sweep (`scripts/cleanup-pending-videos.ts`) | Nothing else notices an upload that was started and abandoned — the API never saw it stop. |

A pleasant side effect: because the browser talks to storage directly, we get
real upload progress from `XMLHttpRequest.upload.onprogress`. Through an API
proxy the progress bar would only ever have measured the first 6 MB.

### 1.3 The vendor is not chosen

Storage economics for video differ enough between vendors that picking one
early, on no usage data, is a guess. So the vendor sits behind an adapter and
the decision costs one env var and one file whenever we are ready to make it.

---

## 2. The adapter

`backend/src/services/videoStorage/` — see the README there for the full
contract and the steps to add a provider.

```ts
interface VideoStorageProvider {
  readonly name: string;
  createPresignedUpload(input: { storageKey; contentType; maxSizeBytes }): Promise<PresignedUpload>;
  getPlaybackSource(storageKey): Promise<PlaybackSource>;
  delete(storageKey): Promise<void>;
  head(storageKey): Promise<StorageObjectHead>;
}
```

Two details in the types carry the vendor-neutrality:

- **`PlaybackSource.kind`** is `'file' | 'hls'`. A raw-file provider returns
  `'file'`; a transcoding provider returns `'hls'` and a poster. The frontend
  already branches on it, so adopting adaptive bitrate does not reshape the
  player component.
- **`Video.storageProvider`** records which adapter wrote each object, so a
  vendor switch does not strand existing rows by signing their keys against a
  bucket that never held them.

Selection is lazy and failure-tolerant by design: `VIDEO_STORAGE_PROVIDER`
defaults to `none`, which resolves to a noop adapter whose every method throws a
clean `503`. The app boots and serves auth, matches, analytics and chat with
zero video configuration. This is deliberate — the hardening pass fixed exactly
this bug in `lib/supabase.ts`, where a module-load throw over a storage
misconfiguration took down the entire API.

---

## 3. The deferred decision

| | Supabase Storage | Cloudflare R2 | Cloudflare Stream / Mux |
| --- | --- | --- | --- |
| **Storage cost** | Highest of the three | Cheapest | Priced per minute stored, not per GB |
| **Egress cost** | Charged, and video egress is the dominant cost at any real usage | **Zero** | Included in per-minute delivery pricing |
| **Transcoding** | None — the MP4 you upload is the MP4 you serve | None | Yes, multi-bitrate ladder |
| **Seeking on a 90-minute recording** | Poor. A raw MP4 seek is a range request into a large file; if the `moov` atom is not at the front, the browser downloads a great deal before it can play at all | Same as Supabase — same raw file, cheaper bytes | Fast. Segmented manifest, seek fetches one segment |
| **Thumbnails / posters** | Build them ourselves | Build them ourselves | Generated |
| **Player** | Native `<video>` | Native `<video>` | Built-in player, or `hls.js` against the manifest |
| **Operational surface** | None — already our database and attachment vendor | New account, S3-compatible SDK dependency | New account, webhook-driven ready/failed lifecycle |
| **Adapter effort** | Done | ~1 file, needs an S3-compatible SDK | ~1 file, plus asset-status handling |

### What actually decides it: `VideoTimestamp`

The point of video in this product is not archival, it is the jump-to-moment
feature. A coach tags a moment and clicks it later; `VideoTimestamp` links to an
`Event`, so the natural next step is jumping straight from a rally in the
analytics view into the footage of that rally.

That interaction is *made of seeks*. On a raw 90-minute MP4 every one of them is
slow, and the feature feels broken in a way no amount of frontend work fixes.
Adaptive streaming is not a nice-to-have for this feature; it is most of what
makes it work. **This is the strongest argument for Stream or Mux over the two
raw-file options**, and it should outweigh the storage-cost comparison unless
usage stays trivially small.

### The free-tier reality

The Supabase free tier gives **1 GB of total file storage and 5 GB of egress per
month**. A 90-minute match at a sane bitrate is comfortably over 1 GB on its
own. That is not "a few matches" — it is roughly *one*, and the egress allowance
is a handful of views of it.

So Supabase Storage is implemented and correct, but it is the development and
proof-of-concept path, not the answer for a team that actually films its season.
Any real usage requires either a Supabase paid tier or one of the alternatives —
which is precisely why the decision is deferred behind an adapter rather than
guessed at now.

### Recommendation when the decision is picked up

Weigh Cloudflare Stream or Mux first, on the seeking argument. Fall back to R2
if video turns out to be archival-only in practice (uploaded, rarely watched),
because then zero egress dominates and seek latency stops mattering. Supabase
Storage stays as the zero-extra-vendor option for development.

**Updated after implementation (see §3b):** this is now more than a preference.
Supabase's resumable uploads must be proxied through this API to keep the
service-role key server-side, and that proxy cannot run on Netlify Functions.
Supabase is a local and self-hosted option; **any of the three alternatives is
required before video ships to production on the current hosting.** The
free-tier egress ceiling points the same way.

---

## 3b. What building it on Supabase actually taught us

Everything in §1 held. What §1 did not know is how narrow the Supabase path is.
Four constraints surfaced during implementation, and together they turn "start
on Supabase, decide later" into "start on Supabase *locally*, decide before
production."

### The 6 MB standard-upload ceiling → TUS is mandatory

Supabase's ordinary single-request upload — `createSignedUploadUrl` plus a PUT —
is documented as reliable only up to **6 MB**. Past that the supported paths are
**TUS resumable** or S3 multipart, which reach 50 GB.

So even a 30 MB clip was on a code path not built for it. The adapter now speaks
TUS. That is strictly better anyway: a non-resumable PUT that dies at 90% of a
2 GB upload starts again from zero, which on a coach's home connection is the
difference between "annoying" and "unusable."

### Chunks are exactly 6 MiB, and that is not negotiable

Supabase requires precisely `6 * 1024 * 1024`. It looks arbitrary, so it is
pinned in `lib/tusUpload.ts` with a comment and a test asserting the constant —
someone will eventually try to tune it.

### The proxy, and why it does not work on Netlify

TUS needs an `Authorization` header. For Supabase that is the **service-role
key**, which bypasses RLS across every bucket and table. Putting it in the
upload intent would publish full admin access to anyone who opens the network
tab — so the browser uploads to a same-origin proxy on this API, which injects
the key server-side, streams chunks without buffering, and authorizes every one
against the video row that owns the target object.

That proxy is correct, and it cannot work on Netlify:

> A chunk is **6 MB**. A Netlify Function request payload caps at **~6 MB**,
> about 4.5 MB usable for binary. Every chunk fails.

The two numbers are the same number, and one of them is a vendor requirement.
There is no version of this that fits. Note the shape of the trap: §1.2 already
identified the 6 MB cap as the reason bytes cannot pass through the API — the
proxy is bytes passing through the API, reintroduced by the credential problem
through a side door.

**This is not solved and is not presented as solved.** A startup warning fires
when `VIDEO_STORAGE_PROVIDER=supabase` and `NETLIFY` are both set. Supabase is
fully usable for local development and any self-hosted runtime; production needs
a provider that issues credentials the browser can hold safely, so no proxy
exists to be capped:

| Provider | Why no proxy is needed |
| --- | --- |
| Cloudflare R2 | Presigned multipart URLs are scoped to one object — safe in a browser |
| Cloudflare Stream | Direct-upload URLs, single-use and scoped |
| Mux | Direct-upload URLs, single-use and scoped |

This materially strengthens the §3 recommendation. It is no longer only about
seek performance: **on the current hosting, Supabase cannot serve production
video at all.**

### The 50 MB per-file cap on Free, and the two-settings trap

A Supabase Free project caps individual files at **50 MB**, and that ceiling
cannot be raised on that plan. `VIDEO_MAX_SIZE_BYTES` defaulted to 500 MB, so
the app advertised ten times what the storage would accept.

Worse, the app limit and the bucket limit are *independent settings* and only
the bucket's is enforced while bytes move. The failure therefore lands after the
user has uploaded — the most expensive possible moment to discover a
configuration error. Three layers now prevent it:

1. The default is **50 MB** — a value that works on the plan a fresh install is
   most likely on. Raising it is a deliberate act requiring both settings.
2. A **boot log** states the effective limit and warns above 50 MB.
3. **`npm run check:video`** checks the live bucket — exists, private, size
   limit ≥ the app's, MIME types cover the allow-list — and round-trips an
   upload, `head()`, signed URL, and delete. Non-zero exit, so a deploy gates on it.

### Egress will bite before storage does

The Free tier's 1 GB storage is the limit people notice. **5 GB of egress per
month is the one that actually bites**, and sooner.

Playback is a signed URL to a raw MP4 with no transcoding and no adaptive
ladder, so **every view re-downloads the whole file**. One 800 MB match watched
six times is the entire monthly allowance. A coach reviewing the same match
across a week can exhaust it alone — and seeking makes it worse, because range
requests into a large MP4 refetch far more than the seconds actually watched.

This is the same argument as §3's seeking point arriving from the cost side: a
transcoding provider serves a fraction of the bytes for the same viewing,
because the player fetches only the segments actually watched at only the
bitrate actually needed.

## 4. What ships now

- Provider-agnostic adapter: interface, Supabase implementation, noop default.
- Presigned direct-to-storage upload, verified server-side via `head()`.
- `PENDING` / `READY` / `FAILED` lifecycle, with pure state rules in
  `lib/videoStatus.ts` and validation in `lib/videoValidation.ts`.
- Signed playback URLs; every video endpoint team-scoped.
- Legacy rows (`filePath` set, `storageKey` null) still list, and return `410`
  with a specific message on playback rather than crashing.
- Frontend upload with real progress, dormant behind `features.video = false`.

Not shipped, deliberately: R2, Stream and Mux adapters; a scheduler for the
orphan sweep; duration extraction (`durationSeconds` exists, unpopulated — a
transcoding provider would supply it for free).

---

**Resolved in v** *(left blank until the vendor is chosen)*
