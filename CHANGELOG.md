# Changelog

All notable changes to VolleyVision, reconstructed from the repository's commit and tag history. Versions are listed newest first, in chronological order of release. Untagged commits are listed under the tagged release they shipped with.

## v9.10.0 — unreleased

Phase 5 of the rebuild roadmap: the Android app. The app is built and tested
but not in the Play Store yet (there's no Play Store account). An iPhone app
needs a Mac or a cloud build service and an Apple Developer account, so it's a
later phase.

- **VolleyVision for Android.** The same app, as an installable Android app
  (app.volleyvision). It signs in, tracks matches, shows the dashboards and
  court zones, chats, and works in portrait and landscape.
- **Feels like an Android app.** The back gesture steps back through the
  screens you visited (and closes an open menu first), and leaves the app from
  the first screen. Pages sit clear of the status bar and gesture bar. It has
  its own icon and splash screen.
- **Copying works everywhere.** Copy Report and copying a join code now fall
  back to another way of copying when the browser or app refuses, and say so
  if it still fails. (The Android app refused the usual way outright.)
- **Links in emails open the website,** not the app: verify, reset and invite
  links still work, in the browser.
- **The API accepts the app.** It answers the exact extra origins in
  CORS_EXTRA_ORIGINS (the app runs from https://localhost). Sign-in is a bearer
  token, never a cookie. Production needs CORS_EXTRA_ORIGINS=https://localhost.
- **Safe release builds.** A release build refuses to build if its settings
  could still reach plain HTTP or load remote code (those are allowed only in the
  emulator build). CI builds the app on every pull request.
- **Offline tracking** (keep tracking with no signal, sync later) comes in
  Phase 6.

How to build it: see "Building the Android app" in the README.

## v9.9.0 — 2026-09-29

Phase 4.5 of the rebuild roadmap: per-team roles. No migration.
Deployed to production on 2026-09-29.

**No more Coach/Player switch: what you can do depends on your role in each
team; anyone can start a team.**

- **One home page.** It shows a card for each of your teams with your role
  there (Coach, Staff, Player or Viewer) and the team's next match, plus your
  own stats if you have a player record. Old /coach and /player links still
  work and land on the home page.
- **Your role, team by team.** Each team's pages show your role there. A coach
  who also plays on the same team sees the full coach view plus their own
  "My Stats". A coach on one team who plays on another gets coach tools on the
  first and the player view on the second.
- **Anyone can create a team** and becomes its coach. Each account can own up
  to 5 teams (transfer or delete one to create another), and team creation is
  limited to 5 an hour.
- **Sign-up and welcome.** The "coach or player" question only tailors your
  welcome. The welcome page offers both creating a team and joining one with
  a code.
- **Smaller things.** Busy moments no longer fail with "someone else changed
  this" when two people create their first team at once. The roster fits a
  phone screen.

## v9.8.0 — 2026-09-29

Phase 4.0 of the rebuild roadmap (carry-over security fixes from an
independent review of v9.3.0–v9.7.0) and Phase 4 (court zones and heat maps).
No migration. Deployed to production on 2026-09-29.

**A correction to v9.6.0.** v9.6.0 said individual stats go only to a team's
staff and the player themself. That was true only on the player stats page.
The team and match dashboards, the match report and the event log still sent
every player's numbers to every member. v9.8.0 completes the rule there.

- **Court zones and heat maps.** The match and team dashboards now show where
  on the court things happen: tap Attack, Serve, Pass or Defence to see each
  zone's count, attempts and efficiency on a 4 3 2 / 5 6 1 court. Coaches and
  the player themself also get a player's own map on the player page. Every map
  says how many actions it's based on, since picking a zone is optional while
  tracking. The match report's "attacks originated from Zone N" line links to
  the map.
- **Each player's numbers are theirs and their coaches'.** Players and viewers
  see the team's totals plus only their own stats. The team and match
  dashboards show them a "Your stats" card instead of the leaderboards and the
  full player table; the match report leaves out the top performer; and in the
  event log, other players' actions show the team name instead of who did it.
  Coaches, statisticians and the player themself see everything as before.
  The server leaves the other players out, so they aren't just hidden on
  screen. Players can be minors.
- **Coaches link players to their records.** A player could claim any
  unclaimed record on their team, including a teammate's, and then see that
  teammate's stats. Now staff link a member to their record from the roster
  ("Link to member" / "Unlink"). Players who join with the player code still
  get their own record automatically.
- **Your player page shows the teams you're on.** Career stats, recent
  matches, bests and upcoming games on your player page now count only teams
  you belong to. A record that another team also plays for keeps that team's
  numbers with that team's coaches.
- **Invite codes stay out of error reports.** Join codes and invitation
  links in a request's path are replaced with placeholders before an error
  reaches Sentry, on the server and in the browser.
- **No reload loop in private browsing.** After a deploy, a stale tab reloads
  once to pick up the new version. With browser storage blocked it can't tell
  it already tried, so it now shows the error instead of reloading forever.
- **Text colours that never showed.** About 50 labels used grey shades the
  design system doesn't define, so they rendered in the wrong colour. They now
  use the defined greys.
- **Behind the scenes.** Production deploys always name the target site. The
  integration tests refuse to run against anything but a local database, even
  when started directly. CI now checks that Supabase's public roles hold no
  table grants. The authorization test matrix covers 72 routes, including the
  player and coach portals and the invitation routes.

## v9.7.0 — 2026-09-28

Phase 3 of the rebuild roadmap: the core screens work on a phone. Checked
on a 360-pixel-wide screen, the narrowest common Android size. No migration.
Deployed to production on 2026-09-28, together with v9.4.0–v9.6.0.

- **Live tracking on a phone.**
  - Event buttons sit two across below tablet width, so labels like
    "Attack Error" stay readable. Tablets and desktops keep the full row.
  - Every toggle, chip and checkbox is at least 44 pixels tall, big enough
    to hit mid-rally.
- **Live scoreboard.**
  - Set buttons and Undo/End Set/Reset controls are full-size touch targets.
  - The score shrinks slightly on small phones so nothing is cut off.
  - Long team names now shorten with "…" instead of pushing the layout.
- **Match and team dashboards.**
  - Grey-on-white text that was hard to read now has proper contrast.
  - Long team names shorten cleanly.
  - Charts fit the screen and show every player's name.
  - Leftover old-style colours are gone from the dashboard cards.
- **Header and match navigation.**
  - Menu, bell and profile buttons, the Stats/Events/Track tabs, "Back to
    Matches" and the match status menu are all easy to tap.
  - The signed-out header no longer squashes "Sign in" onto two lines.
- **Tests can't reach production by accident.** Running a single HTTP test
  directly (not through `npm test`) now uses the same safe settings as the
  test runner.

## v9.6.0 — 2026-09-28

Phase 2 of the rebuild roadmap: security hardening. Closes every
authorization, rate-limit and reliability defect the roadmap confirmed in
code. No migration. Deployed with v9.7.0.

- **Team ids never leak.** Anyone who isn't on a team now gets "not found"
  from every one of its pages and actions, the same as for a team that
  doesn't exist. Before, most staff actions and team chat answered
  "forbidden", which confirmed the team was there.
- **The staff join code is for trusted staff only.** Assistant coaches and
  statisticians no longer see it (only members with full invitation access
  do), and it can no longer make anyone a Manager: managers join by email
  invitation, which goes through the approval queue.
- **Only the team's owner can delete it.** Managers could before, and a
  delete takes the roster, matches and every stat with it.
- **Individual player stats are for the team's coaches and the player.**
  A player's stats page now shows one team's matches at a time, and only
  that team's coaching staff (and the player themself) can open it.
  Teammates and viewers keep the team-level dashboards. It used to add up
  every team the player had ever played for.
- **Approvals can't be applied twice.** Two coaches approving the same
  request at once used to apply it twice (for example, two copies of a new
  player). Now one wins and the other is told it was already resolved.
- **Password resets can't be blocked by one person.** One address could use
  up the whole site's reset allowance, locking everyone out for 15 minutes.
- **Unlinking a player checks the right team.** A coach could unlink a
  player from a team they had nothing to do with.
- **Smaller fixes:**
  - invitations are rate-limited (20 an hour per person)
  - event recording is rate-limited (generously, 600 per 10 minutes)
  - inviting " Coach@Club.nz " no longer duplicates a pending invite for
    "coach@club.nz"
  - a stalled mail server no longer hangs sign-up or invitations
  - malformed sign-in data returns a clear error instead of a server error
  - the activity log handles a bad page size
  - sign-up now requires a complete email address

## v9.5.0 — 2026-09-28

Phase 1 of the rebuild roadmap: the tooling that proves every later change
before it reaches real teams. Nothing changes for users. One migration,
applied to production on 2026-09-28 just before the v9.7.0 deploy.

- **Row-level security on every table, in a migration.** Production had RLS
  switched on by hand for most tables, but only two were ever in a migration,
  so a database rebuilt from migrations (a staging copy, a restore, CI) would
  have left 19 tables readable through Supabase's public API. The new
  migration switches RLS on for every table and removes Supabase's default
  public-role grants. The app never uses those, so nothing it does changes.
  Applied to production on 2026-09-28. Staging will get it when staging is
  created.
- **Every authorization rule has a test.** A new integration suite runs the
  real app against a real database and calls every team route as an outsider,
  a viewer and a player. Where the app doesn't yet meet the target (outsiders
  should always get "not found"), the gap is recorded for Phase 2 to close. A
  second check fails if any table is ever created without RLS.
- **CI checks the database too.** A new job builds the whole schema from the
  migrations on a throwaway Postgres, fails if `schema.prisma` has drifted
  from them, and runs the integration suite. CI still never touches Supabase.
- **Faster HTTP tests** run the whole app over the fake database in
  `npm test`, so middleware order and status codes are checked on every
  commit. The unit tests can no longer reach the production database, even
  by mistake.
- **Staging is ready to create.** A seed script (pre-verified users for every
  role, two teams, two matches) that refuses any database but staging's, a
  post-deploy smoke check, `deploy.ps1 -Target staging`, and
  `backend/.env.staging.example`. Staging errors will report to Sentry as
  "staging", not "production".
- **Safer production deploys.** `deploy.ps1` now refuses a dirty working tree
  or a branch other than `main` unless you pass `-Force`, and runs the smoke
  check after deploying.

## v9.4.0 — 2026-09-28

Phase 0 of the rebuild roadmap: removes an unused API. No migration.

- **Removed: the training-session API.** Two endpoints under
  `/api/v1/training-sessions` were live but no screen ever used them, so
  they're gone. The `training_sessions` table stays, and training events stay
  out of match statistics. No migration.

## v9.3.2 — 2026-09-28

- **Open tabs recover after a deploy.** A tab left open across a deploy
  still asked for the old build's page files, which the deploy removed, so
  the next page change failed with "Failed to fetch dynamically imported
  module" (Sentry VOLLEYVISION-2). The app now reloads once to pick up the
  new version. It won't reload more than once every 10 seconds, so a real
  missing file still shows up as an error.
- **The live function no longer starts a local server.** The guard checked
  `NETLIFY`, which only exists during builds, so every cold start opened a
  useless `localhost:3001` listener. It now also checks
  `AWS_LAMBDA_FUNCTION_NAME`, which is always set inside the function.

## v9.3.1 — 2026-09-28

- **Fix: the admin "Send API test error" button never reached the API.** It
  sent a `null` body, which the HTTP client serialises as the text `"null"`.
  The server's JSON parser only accepts objects and arrays, so it rejected
  the request with a 400 before the test endpoint ran. The button now sends
  `{}`. The browser half of the check had already passed: the probe was
  scrubbed from the URL and the breadcrumbs, and the source-mapped stack
  trace pointed at the right line.

## v9.3.0 — 2026-09-28

Closes the observability work the September audit left open. No migration.

- **`/health` checks the database.** It returns 503 when the database can't be
  reached. It used to answer "ok" without touching the database, so it stayed
  green while Supabase was paused on 27 Sept.
- **Sentry privacy fix: navigation breadcrumbs are scrubbed.** The browser
  scrubber cleaned a breadcrumb's `url` but not the `from`/`to` of a
  navigation breadcrumb. After a visit to `/redeem-invitation?code=…`,
  `/reset-password?token=…` or `/verify-email?token=…`, the team join code or
  token could ride along on any later error in the same session.
- **Backend errors carry their own request.** Netlify's wrapper runs Express
  without an HTTP server, so Sentry's request instrumentation never ran. Each
  invocation now gets its own Sentry scope, its method and path (never the
  query string) and a root span, so backend traces work too.
- **Admin-only Sentry check** on the Feedback page. One button throws in the
  browser, the other makes the API fail. Each plants a probe in a query string
  that must not appear anywhere in Sentry.
- **`netlify.toml` is tracked again.** It holds no secrets, and deploys should
  be reproducible from a clone. Its note on the Node version is corrected.
- **Backend breadcrumbs are scrubbed too.** Outgoing-HTTP breadcrumbs kept
  their full URL, query and fragment on the backend. They're now path-only,
  the same as in the browser.
- **Node 24 everywhere.** The live function already ran Node 24, while the
  repo, CI and build config said 22. They're now aligned, so CI tests the
  runtime that actually serves traffic.
- **Netlify auto-builds are stopped.** Deploys only go out through
  `deploy.ps1`, which refuses to deploy while migrations are pending. The
  GitHub link stays connected.

## v9.2.0 — 2026-09-27

The final release of the September 2026 audit. No migration.

### Phase 4: tests and error handling

- **Requests no longer hang when the database fails during a permission
  check.** Express 4 ignored rejected async middleware, so the request sat
  until the function timed out. `asyncHandler` now turns that into a
  normal 500. It's applied to all 12 async guards.
- **One error-response path.** Four controllers used to answer errors
  themselves, bypassing the shared handler. A single tested mapping now
  covers every error, and response shapes are unchanged.
- **Tests for the security fixes.** A small fake-database harness
  (`backend/src/testing/`) lets middleware, services and controllers be
  tested without a database or any test framework. 10 new test files cover:
  token revocation, admin and team permissions, team-scoped member lookups
  (mutation-checked), role limits, ownership transfer, the
  email-verification gate, the stale invite role, and member-email
  visibility. That's 31 test files in total, all running in CI.
- **Minor fixes from the Greptile review.**
  - The verify-email page handles a second link opened in the same tab.
  - A failed profile refresh no longer shows a false verification failure.
  - Role pickers only offer roles the viewer can actually grant.

## v9.1.0 — 2026-09-27

Review fixes and tooling from the September 2026 audit. No migration.

### Phase 3: tooling

- **CI:** GitHub Actions checks both packages on every PR and on every push to
  `main`/`develop`. It runs `prisma validate`, type-checks, tests, lints,
  builds, and a production dependency audit that fails on high-severity
  advisories. It never touches the database and never deploys.
- **Lint works:** `npm run lint` in `frontend/` uses ESLint 9 with the
  standard React-TypeScript rules and passes with zero warnings.
- **Security headers** in `frontend/public/_headers`: a Content Security
  Policy, clickjacking protection (`frame-ancestors 'none'` and
  `X-Frame-Options`), `nosniff`, a referrer policy, a permissions policy
  and HSTS.
- **react-router 7:** fixes the remaining frontend advisory (an open
  redirect). Both packages now report 0 production vulnerabilities.
- **Readable production stack traces:** source maps upload to Sentry during
  the build once `SENTRY_AUTH_TOKEN` is set in Netlify, and they're deleted
  before publishing, so they never ship to the site.
- **`deploy.ps1` fixed:** it no longer aborts on npm's harmless warnings
  under Windows PowerShell 5.1.

### Phase 2.1: review fixes

Fixes for the nine real findings in Greptile's review of #7 and #9, each
checked against the code first.

- **An approved invitation re-checks the inviter's current role.** A queued
  invitation used to keep the role from when it was requested, even if the
  inviter had been demoted since.
- **Names in emails are HTML-escaped.** First names, inviter names and team
  names could inject markup into mail sent to other people.
- **Concurrency.** The check and the write now run in one serializable
  transaction, and a lost race returns a retryable 409 instead of a 500, for:
  - role edits and removals racing an ownership transfer
  - two player claims at the same moment
  - ownership transfer itself
- **Registration is atomic.** The verification token is saved with the new
  account in a single write.
- **Verification and reset links are strictly single use,** even when two
  requests arrive at once.
- **Password-reset emails are awaited,** so Netlify can no longer drop them
  after responding. The anti-enumeration delay on forgot-password rises from
  1.2s to 4s so it still covers the send.
- **A mistyped password no longer logs out an existing session.**
- **`CLAUDE.md` and `netlify.toml` are no longer committed.** They're kept
  locally instead, and neither ever contained a secret. `.gitignore` now
  catches every `.env*` variant except `.env.example`.

## v9.0.0 — 2026-09-27

The first release of the September 2026 audit. It's a major version because
features and API endpoints were removed and email verification became
mandatory. It ships two migrations. Git tag `pre-feature-removal` marks the
last commit before the removals.

### Phase 2: coach roles and email verification

- **One head coach, at most two assistant coaches, per team.**
  - The head coach is the team owner and only changes through ownership
    transfer. It's gone from every role picker and can't be invited or given
    by a role edit.
  - A third assistant coach is refused on every path (invite, staff code,
    role change). The check runs in a serializable transaction, so two people
    joining at once can't both take the last slot.
  - A partial unique index enforces the head-coach rule in the database too.
- **Ownership transfer bug fixed.** The old owner used to stay on as a second
  head coach. They now become an assistant coach, and if both assistant slots
  are taken the transfer is blocked until one is freed.
- **Re-saving a member's unchanged role no longer resets their custom access
  settings.**
- **Email verification.**
  - Every account, including existing ones, must verify its email before
    joining a team (invitation, join code or claiming a player record).
  - Unverified users can still sign in; they see a banner with a resend button.
  - Links expire after 24 hours and work once. Resend is rate limited.
- **Sessions are revoked on password reset.** Every token carries a version
  that's checked on each request, so resetting a password signs out every
  other device. Existing sessions keep working through the deploy.
- Migration `20260927130000_roles_and_email_verification` must be applied
  before deploying.

### Phase 1B: security fixes

These come from the September 2026 security audit. Each fix is its own commit, and the details are in
[docs/audit/AUDIT-LOG.md](docs/audit/AUDIT-LOG.md).

- **Critical: member edits were not tied to their team.** The owner of any
  team could promote themselves to head coach on, demote, or remove members
  of any other team. Member lookups are now scoped to the team in the URL.
- **Join codes no longer leak.** Every team read returned the player and staff
  join codes to all members, so a player could join a second account as a
  manager. The Prisma client now omits them globally, and only the join-codes
  endpoint (behind MANAGE_MEMBERS) selects them.
- **Login, register and reset-password are rate limited,** per email and per
  IP, using the Postgres-backed limiter.
- **Dependency advisories fixed:** multer, nodemailer, image-size,
  body-parser, morgan and axios.
- **Authorisation holes closed:**
  - Player edits resolve the player's team from the record, not the request body.
  - Linking a player needs rights on their home team too.
  - Stats can only be recorded against the match's own players.
  - An invited role can't outrank the inviter, and head coach can never be invited.
  - Admin rights are read from the database instead of the 7-day token.
- **Privacy:**
  - Only roster managers see member email addresses.
  - Login takes the same time whether or not the email exists.
  - Join codes, emails and query strings are kept out of logs.
  - Profile images can only come from our own storage host. The free-text
    image-URL field on the Profile page is removed.
- **No more adding people without consent.** "+ Add member", which put any
  existing user straight onto a team, is replaced by "+ Invite staff", using
  the staff code or an email invite. The user-by-email lookup behind it is
  gone.
- **Approvals and claims:**
  - Approvers can't approve their own requests (the owner is exempt).
  - Only player-role members can claim a roster record, one per team.

### Phase 1A: removed features

Reset to a smaller, cleaner core before the February 2027 beta. Every feature
that was built but switched off behind a flag has been **deleted**, not
parked. They're recorded here, and in full in
[docs/audit/AUDIT-LOG.md](docs/audit/AUDIT-LOG.md), because leagues and video
are planned to come back much later. Git tag `pre-feature-removal` is the last
commit that still has them.

- **Removed: Leagues.** This covers league hub, seasons, standings, rankings,
  fixtures, results, team profiles, match centre, and the team form's
  "current league" field. The `leagues`, `league_seasons`, `league_teams` and
  `league_matches` tables and `teams.league_season_id` are dropped. Several of
  these routes were live on the server even though the UI hid them, and some
  needed no login.
- **Removed: Match video.** This covers YouTube linking, presigned and TUS
  upload, match-time sync and clips. The `videos` and `video_clips` tables and
  the `VideoStatus`, `VideoSource` and `ClipOrigin` enums are dropped, along
  with the `tus-js-client` dependency and all `VIDEO_*` env vars.
- **Removed: Assistant and the AI match summary.** The summary made an uncached,
  unmetered paid Claude call on every page view. The `@anthropic-ai/sdk`
  dependency and `ANTHROPIC_API_KEY` are gone.
- **Removed: heat maps and zone detail, recommendations** (coaching, training,
  player development, season intelligence, advanced metrics), **rotation
  analytics, momentum chart, and opponent scouting reports.** The match
  report is kept, and it still uses the momentum and rotation calculations
  internally. Live scoring of opponent points is kept.
- **Removed: manual harness scripts.** These are `smoke-*.ts`,
  `supabase-smoke.ts`, `verify-chat*.ts`, `check-video-config.ts` and
  `cleanup-pending-videos.ts`.
- **Unknown URLs now redirect to the app** instead of rendering a blank page,
  so old bookmarks to removed pages still land somewhere.
- **Sentry scrubbing.** Query strings, which carry reset tokens and email
  addresses, auth headers and span URLs are stripped before events are sent.

About 14,500 lines deleted in total. Migration
`20260927120000_remove_leagues_and_video` must be applied with
`prisma migrate deploy`, after a database backup, before this is deployed.

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
