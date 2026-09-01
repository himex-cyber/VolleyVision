# Changelog

All notable changes to VolleyVision, reconstructed from the repository's commit and tag history. Versions are listed newest first, in chronological order of release. Untagged commits are listed under the tagged release they shipped with.

## Unreleased — Match video: YouTube source, match-time sync, clips

Adds a second video source and makes it the primary one. The presigned-upload
path below is untouched and still dormant — it is now the private-storage
option. `features.video` stays `false`, but unlike the upload path, flipping it
needs no bucket, no env vars, and no cost. See
[docs/design/video-sources-decision.md](docs/design/video-sources-decision.md).

- **A coach can paste a YouTube link instead of uploading.** They put the
  footage on their own channel as Unlisted; YouTube handles storage,
  transcoding, adaptive bitrate, CDN and fast seeking for free. That dissolves,
  in one move, every constraint the previous two passes fought: the storage
  ceiling, the egress bill, the 6 MB Netlify/TUS chunk collision, and the
  credential-proxy problem. `Video.source` splits `UPLOAD` from `YOUTUBE`;
  `filename` and `mimeType` are now nullable because a linked video has neither.
- **URL parsing treats the input as hostile.** Every common form is accepted
  (`/watch?v=`, `youtu.be`, `/embed/`, `/shorts/`, `/live/`, `m.`/`music.`/
  `nocookie` hosts, a bare 11-character id) but the host is checked against an
  allow-list *via the URL parser*, not pattern-matched. A regex looking for
  "youtube.com" anywhere happily accepts `youtube.com.evil.com` and
  `https://www.youtube.com@evil.com/` — both are rejected, and both are tested.
- **oEmbed confirms the video exists and is embeddable** before the row is
  created, with no API key. A 401/403/404 blocks with a message the coach can
  act on ("Unlisted works; private doesn't"); a network failure allows the link
  with a null title rather than blocking a coach over our own connectivity.
- **Match-time sync maps every tracked event onto the video.** One anchor does
  it: the coach scrubs to the first rally and marks it, and
  `recordingStartedAt` is derived by subtracting the playhead from that event's
  real `recordedAt`. Anchoring on an event rather than the wall clock is the
  point — if the tracking device's clock is wrong, the offset appears in *both*
  operands and cancels out exactly, where a wall-clock approach would bake it in
  permanently. Each video carries its own anchor, so a match filmed across three
  set-videos calibrates independently.
- **One-click clip generation from tracked events.** Idempotent (an event that
  already has a `GENERATED` clip is skipped), scoped to own-team events via the
  existing `ownEventsOnly` filter, and honest about what it couldn't do — the
  response reports events that fell outside this video's footage so the UI can
  say "18 clips created, 4 events fell outside this video". Pre-roll is 10 s
  against 4 s post-roll, because a statistician taps the button *after* the
  action, so the rally sits before the recorded instant.
- **Clips are time ranges, never files.** A YouTube embed is a cross-origin
  iframe: JavaScript cannot read its pixels, permanently. Nothing is cut,
  stored, or served — playing a clip is seeking between two numbers. This also
  fixes the shape of two future slices: annotations must be vector overlays
  drawn on top of the iframe and replayed from coordinates, never flattened into
  an image; share-to-chat must be a link to a moment, never an exported file.
- **Consent before linking.** Unlisted is not private — anyone with the link can
  watch, with no login and no expiry. The link form says so plainly and requires
  an explicit tick, and the raw URL is never rendered as a clickable link. The
  acknowledgement is remembered per user in `localStorage`: a nudge at the
  moment of the decision, not a legal record.
- Recalibrating warns that `GENERATED` clips now point at the wrong moments and
  offers to clear them; `MANUAL` clips a coach dragged by eye survive, because
  they were never derived from the anchor.
- Deleting an event sets `VideoClip.eventId` to null rather than cascading. The
  clip survives as an orphan range — the moment still happened.
- `VideoTimestamp` is marked superseded by `VideoClip` (point marker vs. range)
  but left completely intact; no rows migrated, no endpoints changed.
- `getPlaybackSource` returns 400 for a YouTube row (it plays through the embed,
  not a signed URL), and deleting one skips storage entirely — there is no
  object, and the coach's video on their own channel is untouched.
- The player records a deliberate hazard for the annotation slice: iOS Safari
  may force the native fullscreen player, which would leave any overlay behind
  on a page the user can't see. `playsinline` reduces but does not eliminate it,
  and it must be tested on a real device before overlay work starts.

Tests — 23 suites to 25, all passing:

- `youtubeUrl.test.ts` — every accepted URL form plus the hostile ones: lookalike
  hosts, a YouTube path on an unrelated origin, credentials-in-URL, `javascript:`
  and `data:` schemes, and ids of the wrong length or alphabet.
- `videoClips.test.ts` — events before the recording starts and past the end,
  clamping at both boundaries, and a sweep asserting that whenever a range is
  produced at all it is non-negative, correctly ordered, and inside the footage.

## Unreleased — Match video: resumable uploads & config guardrails

Lifts the upload ceiling on the presigned architecture below, and makes a class
of storage misconfiguration impossible to ship unnoticed. Still dormant —
`features.video` stays `false`.

- **Uploads are resumable, and no longer capped at 6 MB.** The Supabase adapter
  used `createSignedUploadUrl` + a single PUT, which Supabase documents as
  reliable only to 6 MB; past that it requires TUS resumable uploads, which
  reach 50 GB. Match footage was going down a path not built for it, and a
  non-resumable PUT that died at 90% of a 2 GB upload restarted from zero. The
  adapter now speaks TUS with the exact 6 MiB chunk size Supabase requires
  (pinned and tested — it looks arbitrary and someone will try to tune it).
- **`PresignedUpload` is a discriminated union.** `protocol: 'http'` is the
  existing single-request path, unchanged, and still correct for small files and
  S3 POST-policy providers; `protocol: 'tus'` is resumable and chunked. The
  frontend branches on the protocol the server states, never on provider name,
  so an R2/Stream/Mux adapter still drops in as one file.
- **The storage credential does not reach the browser.** TUS needs an
  `Authorization` header, and for Supabase that is the service-role key — which
  bypasses RLS on every bucket and table. Returning it in the upload intent
  would have published full admin access to anyone opening the network tab.
  Uploads now go through a same-origin proxy that injects the key server-side,
  streams chunks without buffering, rewrites the TUS `Location` back onto
  itself, and authorizes every chunk against the video row owning the target
  object. Unparseable requests are refused, not allowed.
- **That proxy does not work on Netlify, and is not claimed to.** A TUS chunk is
  6 MB; a Netlify Function request payload caps at ~6 MB. The two numbers are
  the same number and one is a vendor requirement. A startup warning fires when
  `VIDEO_STORAGE_PROVIDER=supabase` and `NETLIFY` are both set. Supabase is a
  local/self-hosted option; production needs a provider issuing browser-safe
  upload credentials (R2 presigned multipart, Cloudflare Stream, Mux).
- **Uploads that outlive their credential now resume.** Supabase's resumable
  token has a fixed two-hour server-side life this API cannot extend, so a
  multi-gigabyte upload on a slow line could expire mid-transfer.
  `POST /videos/:videoId/refresh-upload` issues a fresh credential for the same
  object while the row is `PENDING` (`409` once `READY` or `FAILED`); the client
  retries exactly once, automatically, and resumes from the last committed
  offset. The panel also offers Resume on a `PENDING` video — the user re-picks
  the file and TUS matches it by fingerprint.
- **The size-limit mismatch is caught three ways.** `VIDEO_MAX_SIZE_BYTES`
  defaulted to 500 MB while a Supabase Free project caps files at 50 MB and
  cannot raise it — and because the app limit and the bucket limit are separate
  settings with only the bucket's enforced during transfer, the rejection landed
  *after* the user had uploaded. The default is now 50 MB; boot logs the
  effective limit and warns above 50 MB; and `npm run check:video` verifies the
  live bucket exists, is private, has a size limit at least the app's, covers
  the MIME allow-list, and survives an upload → `head()` → sign → delete
  round-trip, exiting non-zero so a deploy can gate on it.
- Index on `videos.storage_key` — the proxy resolves the owning row once per
  chunk, so a 1 GB upload is ~170 lookups that were sequential scans.
- **The test suite no longer initializes Prisma.** `chat.test.ts` imported
  `permission.service`, which constructs a `PrismaClient` at module load — so a
  suite of pure-logic tests depended on a platform-specific engine binary and
  failed on Linux when generated on Windows. The static role→permission map
  moved to `lib/rolePermissions.ts` and the service re-exports it, leaving all
  20 other importers untouched. It was the only one of the 23 test files
  affected; three others import generated Prisma enums without constructing a
  client, which loads no engine and was left alone.

Tests — 22 suites to 23, all passing:

- `tusUpload.test.ts` — Upload-Metadata round-trip, storage-key recovery from
  both metadata and opaque upload ids, `Location` rewriting, and the refusals
  that matter: a traversal attempt or a key from another namespace yields null,
  which the proxy guard treats as refuse. Caught a real bug in review — the
  fallback id parser was reading the hostname out of `https://host/` and
  returning it as an upload id.
- `videoStatus.test.ts` — extended for `canRefreshUpload`: only `PENDING`, and
  it agrees with the transition table.

## Unreleased — Match video: presigned direct-to-storage architecture

Replaces the match video storage subsystem. Ships dormant — `features.video`
stays `false`. Nothing else changed. See
[docs/design/video-storage-decision.md](docs/design/video-storage-decision.md).

- **Match video upload could never have worked, and now does.** Two independent
  blockers: uploads were written to `uploads/videos` with `multer.diskStorage`,
  but the API runs on ephemeral Netlify containers where only `/tmp` is writable
  and nothing survives an invocation — so every upload was lost and every
  playback 404'd. And a Netlify Function caps a request payload at ~6 MB against
  a route advertising 500 MB, so a match video could not have reached the
  endpoint in the first place. The browser now uploads straight to the storage
  vendor with a short-lived presigned URL; no video byte passes through the API
  in either direction.
- **Uploads are verified server-side, not taken on trust.** Three steps:
  `POST /matches/:matchId/videos/upload-intent` validates the declared type and
  size and issues a presigned URL, the browser PUTs the bytes direct, then
  `POST /videos/:videoId/complete` calls the provider's `head()` and only then
  promotes the row. `Video.status` is `PENDING` / `READY` / `FAILED`; the size
  declared at intent is a client claim and the provider's measurement overrides
  it. An oversize object is deleted and the row fails.
- **The storage vendor is a one-file decision.** Everything vendor-specific
  lives behind `VideoStorageProvider` in `services/videoStorage/`. Supabase
  Storage is implemented; `VIDEO_STORAGE_PROVIDER` defaults to `none`, which
  resolves to a noop adapter whose methods throw a clean 503 — the app boots and
  runs normally with zero video configuration, lazily, the same fix the
  hardening pass applied to `lib/supabase.ts`. `PlaybackSource.kind`
  (`'file' | 'hls'`) and `Video.storageProvider` are what let an
  adaptive-bitrate vendor drop in later without touching controllers, schema, or
  the player component.
- `GET /videos/:videoId/playback` returns a signed URL instead of streaming
  bytes; `streamVideo` and the last `fs`/`path` imports are gone from the videos
  controller. `videosApi.fileUrl()` is replaced by `getPlaybackSource()`.
- Rows predating the migration (`filePath` set, `storageKey` null) still list,
  and return `410` with a specific message on playback rather than crashing.
  `filePath` is kept, nullable.
- Match video lists return only `READY` rows by default; `?includePending=true`
  shows in-flight and failed uploads to staff with `TRACK_MATCH`.
- Deleting a video removes the storage object *first* and keeps the row if that
  fails, so bytes are never orphaned with nothing pointing at them. Audit-logged,
  as is a completed upload.
- New `scripts/cleanup-pending-videos.ts` sweeps `PENDING` rows older than 24 h
  and their objects — nothing else can notice an abandoned upload, since the API
  never saw it start moving. Not wired to a scheduler.
- The upload UI shows real progress, which is only possible because the bytes go
  direct (`XMLHttpRequest.upload.onprogress`); through an API proxy the bar
  would have measured the first 6 MB and stopped.

Tests — 20 suites to 22, all passing:

- `videoValidation.test.ts` — content-type allow-list, size boundaries, filename
  sanitization including POSIX and Windows path traversal, and the fact that the
  storage key is built from server ids only, so a filename cannot reach it.
- `videoStatus.test.ts` — `PENDING` resolves either way, `READY` and `FAILED`
  are terminal, nothing returns to `PENDING`, and oversize-vs-missing precedence.

## Unreleased — Security hardening & reliability pass

Security:

- **Fix an IDOR on the team invitation list.** `GET /teams/:id/invitations` was gated on authentication only, so any logged-in user could read any team's pending invitations — invitee email addresses plus the identity of the inviting staff member. Now gated on `requireTeamAccess('invitation')` like its sibling routes, with a second membership check inside `getTeamInvitations` as defence in depth.
- Audited every route file for the same pattern. One further gap found and closed: `GET /players/:playerId/teams` had no guard at all and is now behind the same visibility contract as the other player reads.
- Video read endpoints (`GET /matches/:matchId/videos`, `/videos/:videoId/file`, `/videos/:videoId/timestamps`) were unauthenticated; they now require team-scoped `VIEW_TEAM`. `requireMatchPermission` takes a param name, matching `requireTeamPermission`.
- **Validate attachments by their bytes, not the client's claim.** Uploads were classified and size-capped from the multipart `Content-Type`, so an executable renamed with an allowed MIME type was stored — and later served through a signed URL — under that attacker-chosen type. New `lib/fileSignature.ts` sniffs magic bytes, rejects any file whose contents contradict its declared type, and stores the verified type on the object. Non-image attachments now sign with `Content-Disposition: attachment` so browsers download rather than render them.
- **Rate-limit and de-time forgot-password.** The endpoint had no limit (email bombing, enumeration hammering) and leaked account existence through response time, since a known address did an extra write and mail send. Now limited to 5 requests per 15 minutes per IP *and* per email, with both branches floored to a fixed duration so timing reveals nothing. Join-code lookup and redemption are limited too.
- The rate limiter is now a shared token bucket (`lib/rateLimit.ts`) with periodic eviction — the old chat limiter's bucket map only ever grew. Chat behaviour is unchanged: `{ max: 10, windowMs: 5000 }` is the same bucket as before.
- `GET /feedback/:feedbackId/attachments/:attachmentId/url` ignored `:feedbackId`; a mismatched pair now 404s.

Reliability:

- **A storage misconfiguration can no longer take down the whole API.** `lib/supabase.ts` threw at module load, and the chat and feedback routers are imported unconditionally — so a missing `SUPABASE_URL` crashed auth, matches and analytics along with attachments. The client is created lazily now; only attachment endpoints fail, with a clean 503.
- **Paginate the feedback lists.** Both the user's own list and the admin list did unbounded `findMany`. Both are cursor-paginated now, returning `{ items, nextCursor }`, with a "Load more" affordance on the Feedback page.
- **Deploys abort on pending migrations.** `deploy.ps1` runs `prisma migrate status` first and refuses to ship code whose migrations haven't been applied, printing the pending names and the command to apply them. Never auto-applies; `-SkipMigrationCheck` opts out.
- Pin the Node runtime (`NODE_VERSION`, `.nvmrc`, `engines.node`) and drop the unused `rhel-openssl-1.0.x` Prisma binary target, which was dead weight in the function bundle.
- `videosApi.fileUrl()` derives its path from the configured API base URL instead of hardcoding `/api/v1`.
- Document every environment variable the backend reads. `JWT_SECRET` is required — unset, every login and register 500s — and was not mentioned anywhere.

Tests — 15 suites to 20, all passing:

- `rateLimit.test.ts` — window expiry, per-key isolation, limit boundary, eviction, and chat-limiter parity.
- `fileSignature.test.ts` — byte-level fixtures per allowed type plus mismatch cases.
- `joinCode.test.ts` — alphabet/format, normalization, collision retry, UUID fallback.
- `feedbackValidation.test.ts` and `passwordReset.test.ts` — pure validators and token rules extracted from their services.

## v8.26.0 — 2026-08-05

- Add missing foreign-key indexes flagged by the Supabase performance advisor: 10 single-column indexes across `approval_requests`, `league_matches`, `matches`, `messages`, `teams`, `training_sessions`, and `video_timestamps`.

## v8.25.0 — 2026-07-24

- Event buttons: bigger labels, volleyball vernacular, split Pass button.

## v8.24.0 — 2026-07-24

- Add forgot-password flow.
- Players can no longer create a team.

## v8.23.0 — 2026-07-23

- Promote-to-Player creates a roster row; one colour per position and role.

## v8.22.0 — 2026-07-23

- Team join codes + inline quick-invite from Roster and Team Members.

## v8.21.0 — 2026-07-23

- Watch polish: matches-list quick-link + instant Track/Watch route sync.

## v8.20.0 — 2026-07-23

- Player view: live Watch page + read-only lens across team pages.
- Feedback: move nav entry into avatar dropdown, center the page.

## v8.19.0 — 2026-07-17

- Feedback tab: submit + my submissions + admin triage, attachments via chat bucket.

## v8.18.0 — 2026-07-17

- Tracking feed + banner sizing: section header, avatar-led rows, taller toggles.

## v8.17.0 — 2026-07-17

- Tracking polish: static LIVE badge, control order, leaner events feed.

## v8.16.0 — 2026-07-17

- Roster & Team Members: accordion edit flow, brand-aligned buttons, roster tab bar.

## v8.15.0 — 2026-07-17

- Iteration 6: match card polish, ghost button style, Stats/Match Stats naming.

## v8.14.0 — 2026-07-17

- Team Chat slice 5: idempotency, moderation audit, rate limit, URL refresh.
- Team Chat slice 4: image/file attachments via Supabase Storage (plus Storage foundation).

## v8.13.0 — 2026-07-17

- Team Chat slice 3: polled chat page (text only).
- Team Chat slice 2: text messaging REST API + permissions.
- Team Chat slice 1: schema, migration, backfill, channel helper.

## v8.12.1 — 2026-07-16

- Events page: link player rows to player dashboard, not match dashboard.

## v8.12.0 — 2026-07-16

- Events page: collapsed sets, table rows with player avatars.

## v8.11.2 — 2026-07-16

- Fix undo of the point that completed a set.

## v8.11.1 — 2026-07-16

- Fix Undo Event ignoring score taps; audit Reset Match.

## v8.11.0 — 2026-07-16

- Iteration 8: withdraw manual End Set/Undo Set, consolidate scoreboard controls.
- Iteration 7: rebuild the live scoreboard as a reusable component.

## v8.10.0 — 2026-07-16

- Iteration 6: tracking focus mode, roster reorder, recent players, button polish.

## v8.9.0 — 2026-07-16

- Iteration 5: full position names, bigger clickable player rows, Game Day Stats heading.

## v8.8.0 — 2026-07-16

- Iteration 4: collapsible set cards, on-brand status menu, player tab bar in match context.
- Fix backend Prisma client/CLI version mismatch.

## v8.7.0 — 2026-07-16

- Iteration 3: Track page position label, bigger per-side score buttons, Reset Set confirm.

## v8.6.0 — 2026-07-16

- Iteration 2: header status dropdown, live-score cache fix, timestamptz migration.

## v8.5.0 — 2026-07-15

- Match workflow: shared header, Track tab, match editing & status control.

## v8.4.0 — 2026-07-15

- Iteration 4: Track page light-mode, clickable match cards, match sub-nav, tab order.

## v8.3.0 — 2026-07-15

- Iteration 3: permissions overhaul, top nav, coach dashboard, training foundation.

## v8.2.0 — 2026-07-15

- Light mode redesign + team ownership model cleanup.

## v8.1.0 — 2026-07-13

- Stabilization Pass 2: team privacy, approval queue, invitation email.

## v8.0.0 — 2026-07-13

- Stabilization pass + official brand implementation.

## v7.6.6 — 2026-06-21

- Added Live Match Centre.

## v7.5.5 — 2026-06-20

- Added Team Ranking and Player Leaderboard.

## v7.4.4 — 2026-06-20

- Added LeagueTeam Profiles and updated APIs.

## v7.3.3 — 2026-06-20

- Add listFixtures to the League.

## v7.2.2 — 2026-06-20

- Added proper scoring for fixtures.

## v7.1.1 — 2026-06-20

- Added League Hub foundations.

## v7.0.0 — 2026-06-20

- Add sign-up role, enhanced TeamsPage.

## v6.9.9 — 2026-06-20

- Added Opponent Scouting.

## v6.8.8 — 2026-06-20

- Added Match Library, Player Accounts, Video Upload.

## v6.5.5 — 2026-06-20

- Updated Assistant.

## v6.4.4 — 2026-06-20

- Added Player Development and Coach Recommendations.

## v6.3.3 — 2026-06-19

- Added Season Intelligence.

## v6.2.2 — 2026-06-19

- Add Player Development Intelligence.

## v6.1.1 — 2026-06-19

- Updated Analytics.

## v6.0.0 — 2026-06-19

- Backend AI Analytics.

## v5.6.8 — 2026-06-19

- Stability update of scoringRules and Auth Login.

## v5.6.7 — 2026-06-19

- Added new types of Attacks.

## v5.6.6 — 2026-06-19

- Added Invitations (follow-up).

## v5.5.5 — 2026-06-18

- Added Player and Coach Portals.

## v5.4.4 — 2026-06-18

- Added Invitations.

## v5.3.3 — 2026-06-18

- Team Memberships.

## v5.2.2 — 2026-06-18

- Added Team Ownership.

## v5.1.1 — 2026-06-18

- Added a Register and Login page for both coaches and players.

## v4.6.5 — 2026-06-18

- Stability Update v2.

## v4.6.4 — 2026-06-18

- Stability Update.

## v4.6.3 — 2026-06-18

- Automated Match Reports.

## v4.5.3 — 2026-06-18

- Advanced Performance Metrics.

## v4.4.3 — 2026-06-18

- Added Rotation Analytics; backend: rotationNumber.

## v4.3.2 — 2026-06-18

- Added Momentum Chart; backend: getMatchMomentum.

## v4.2.2 — 2026-06-18

- Added Match Winner, Highlights; backend: checkSetCompletion, recordEvent.

## v4.0.0 — 2026-06-18

- Added homeScore, awayScore, homeSetsWon to the match table; backend: recordEvent, PATCH, POST.

## v3.5.2 — 2026-06-18

- Added backend court zone validation, optional zone auto-reset, Player Heat Maps, improved tablet usability.

## v0.3.3 — 2026-06-18

- Added CourtZoneSelector, CourtVisualization, HeatMapCourt.

## v2.0.0 — 2026-06-18

- Initial commit.
