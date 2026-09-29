# VolleyVision audit: plan and change log

This is the working record of the September 2026 audit, covering what was planned, removed and changed, and why.
`CHANGELOG.md` gets the user-facing summary. This file keeps the full detail, so a later session (human or Claude)
can see what existed before and bring it back from git history if needed.

**Rule for every phase:** work on a branch, make one logical change per commit, and run `npm test` plus `tsc --noEmit` in both
packages before each commit. Never push, merge to `main`, deploy, or run a migration against Supabase without Karlos's OK.

Sub-agent model per job: Haiku for search and listing, Sonnet for mechanical edits and tests, Opus for schema, auth and security design.

---

## Phase 0: Orient ✅ (2026-09-27)

- Baseline: all 27 backend test files pass. `tsc` is clean in backend and frontend. Frontend lint fails because eslint is not installed and has no config.
- Local `main` was fast-forwarded to `origin/main`, then merged into `develop`. The 4 commits unique to `main` were empty
  merge commits, so no files changed. `develop` is now a superset of `main`. Nothing has been pushed.
- The handoff doc was stale. Sentry, `netlify.toml`, a Postgres-backed rate limiter and `CLAUDE.md` all already exist.
- The security audit found 1 critical, 4 high, 8 medium and 6 low issues. They are listed under Phase 1B.

---

## Phase 1A: Remove features, restarting from a cleaner foundation

Branch: `chore/remove-features` (from `develop`).
Decision (Karlos, 2026-09-27): remove every flag-disabled feature, and delete the smoke scripts.

Order matters. Removal comes before the security fixes because it deletes the attack surface behind M5 (live league
routes) and M6 (the unmetered paid AI call). Fixing code that is about to be deleted would be wasted work.

### Steps
1. Commit the pending Sentry PII-scrubbing change (`instrument.ts`, `main.tsx`) on its own, before anything else.
2. Delete `_to_delete/` (it only holds an empty stale git lock file).
3. Delete these manual harness scripts: `backend/scripts/smoke-invite.ts`, `smoke-scoreboard.ts`,
   `smoke-stabilization.ts`, `smoke-team-join-codes.ts`, `supabase-smoke.ts`, `verify-chat.ts`, `verify-chat-uploads.ts`,
   `check-video-config.ts`, `cleanup-pending-videos.ts`, along with any package.json scripts that point at them.
4. Remove the features. Run two Sonnet agents in parallel, one on the backend and one on the frontend; their files don't overlap:

| Feature | Backend | Frontend |
|---|---|---|
| leagues | `routes/league.ts`, `controllers/league.ts`, `services/league*.service.ts` ×3, their `lib/*.test.ts`; `requireLeagueCreator`; league bits of `controllers/teams.ts` (`leagueSeasonInclude`, `syncLeagueTeam`, `leagueSeasonId`) | 8 league pages, `components/league/`, `lib/resolveFixture.ts`, route block in `main.tsx`, nav link in `Layout.tsx`, league hooks/api/types, `LeagueField` in `TeamsPage.tsx`, `leagueLabel` in `MatchesPage.tsx` |
| video | `routes/videos.ts`, `controllers/videos.ts`, `services/youtubeVideo.service.ts`, `services/videoStorage/`, `lib/{videoClips,videoStatus,videoValidation,tusUpload,youtubeUrl}.ts` + tests, `index.ts` wiring | `components/analytics/VideoPanel.tsx`, `components/video/`, video hooks/api/types, `tus-js-client` dep |
| assistant (incl. AI match summary) | `services/assistant.service.ts`, `services/aiNarration.service.ts`, `lib/assistant.test.ts`, 2 routes, `@anthropic-ai/sdk` dep, `ANTHROPIC_API_KEY` | `AssistantPanel.tsx`, AI summary block in `MatchDashboardPage.tsx`, hooks/api/types |
| opponentScouting | `services/opponentScouting.service.ts` + test, 1 route | `OpponentScoutingPanel.tsx`, hooks/api/types |
| heatMaps | `lib/heatmap.ts`, 6 heatmap routes, the orphaned `/matches/:id/zones` route | `CourtVisualization.tsx`, `HeatMapCourt.tsx`, `CourtHeatMap.tsx`, hooks/api/types |
| recommendations | `services/{coachingRecommendations,trainingRecommendations,playerDevelopment,seasonIntelligence}.service.ts` + tests, advanced-metrics helpers, 6 routes | 5 panels (`CoachingRecommendations`, `TrainingRecommendations`, `PlayerDevelopmentCard`, `SeasonIntelligenceCard`, `AdvancedMetricsPanel`), hooks/api/types |
| rotationAnalytics | 2 routes | `RotationAnalytics.tsx`, hooks/api/types |
| momentum | 1 route | `MomentumChart.tsx`, hooks/api/types |

   **Keep (used by core features):**
   - `momentum.service.ts` and `rotation.service.ts`, because `report.service.ts` (the match report) uses them.
   - `fileSignature.ts`, `@supabase/supabase-js`, `multer` and `image-size`, because chat and feedback attachments use them.
   - `Event.isOpponentEvent`, `courtZone`, `rotationNumber` and `rallyNumber`, because live scoring and the match report use them.
   - `chartColors.ts`, `recharts`, `CoachInsights`, `PlayerInsights`, `lib/insights.ts` and `MatchReportCard`.
5. Remove the `features.ts` flags for the deleted features. Only `teamChat` remains.
6. Clean up env files and docs:
   - Remove `ANTHROPIC_API_KEY` and the `VIDEO_*` block from `backend/.env.example`.
   - Delete `docs/design/video-*.md`.
   - Update `CLAUDE.md` by removing the Video section and the flag-disabled list.
7. Write a **new** Prisma migration (Opus writes it, and existing migrations are not edited):
   - Drop the tables for `League`, `LeagueSeason`, `LeagueTeam`, `LeagueMatch`, `Video` and `VideoClip`.
   - Drop the enums `VideoStatus`, `VideoSource` and `ClipOrigin`.
   - Drop `Team.leagueSeasonId` and its index.
   - Check `20260902100000_enable_rls_on_public_tables` for policies on the dropped tables.
   - **It is not applied until Karlos has backed up the database and approves.**
8. Verify: `npm test`, `tsc` for both packages, `npm run build` for both, then load the app in the preview and click through
   teams, matches, tracking, the match report and chat.
9. Add a `CHANGELOG.md` entry and fill in the "Removed" log below.

Size: roughly 11,900 lines deleted, `@anthropic-ai/sdk` and `tus-js-client` dropped, and 6 tables dropped.

---

## Phase 1B: Security fixes

Branch: `fix/security`. Each fix is its own commit with a failing-then-passing test where the logic is testable.

| ID | Fix | Where |
|---|---|---|
| C1 | Scope member update and remove to the team in the URL: `where: { id, teamId }`, and return 404 on a mismatch | `services/teamMembership.service.ts` `updateMemberRole`, `updateMemberAccess`, `removeMember` |
| H1 | Never return join codes from general team reads. Use an explicit `select` or an omit, and only return codes from `GET /:id/join-codes` | `controllers/teams.ts` (getTeams, getTeam), `controllers/players.ts:29` |
| H2 | Rate-limit login, register and reset-password per IP and per email, reusing `createRateLimit` and the Postgres limiter | `routes/auth.ts`, `middleware/rateLimit.ts` |
| H4 | `npm audit fix` for multer, nodemailer and image-size, then re-run the tests | `backend/package.json` |
| M1 | For player `:id` routes, resolve the team from the player record and never from `body.teamId` | `routes/players.ts:37` |
| M2 | Linking a player also requires permission on the player's home team | `controllers/playerTeamLinks.ts` |
| M3 | `recordEvent` checks the player belongs to, or is linked to, the match's team | `controllers/events.ts` |
| M4 | An invited role can't be higher than the inviter's own role, and HEAD_COACH can never be invited (see Phase 2) | `controllers/invitation.ts` |
| M7 | `requireAdmin` reads the role from the database. Add `User.tokenVersion`, bumped on password reset or change, and check it in `authenticate` | `middleware/permissions.ts`, `middleware/auth.ts` (the schema change ships with Phase 2's migration) |
| M8 | Only members who hold MANAGE_MEMBERS see email addresses | `teamMembership.service.ts` member list |
| L1 | Register returns the same response whether or not the email exists; login does a dummy bcrypt compare for unknown emails | `services/auth.service.ts` |
| L2 | Stop logging join codes and emails; stop morgan logging query strings | `invitation.service.ts:56`, `index.ts` |
| L3 | An approver can't approve their own request | `approval.service.ts:71` |
| L4 | A member can only claim the player record that matches their own identity (the invite or join-code link), not any unclaimed record | `playerPortal.service.ts:86` |
| L5 | `POST /teams/:id/members` stops adding users without consent: it creates an invitation instead | `controllers/teamMembership.ts` |
| L6 | `profileImage` only accepts our own storage URL (or is dropped) | profile update validator |

Fixed by Phase 1A: M5 (league routes) and M6 (AI summary). Fixed by Phase 2: H3 (email verification).

---

## Phase 2: Coach rule and email verification (one schema migration)

Branch: `feat/roles-and-verification`.

### Coach rule (decided 2026-09-27): exactly 1 HEAD_COACH per team and at most 2 ASSISTANT_COACH
- HEAD_COACH is only ever set through the owner sync (`syncOwnerMembership`). It is removed from the roles allowed by
  add-member, update-member and invitations. The only way to change the head coach is an ownership transfer.
- Add a guard `assertRoleSlotAvailable(teamId, role, excludeMembershipId?)` called from the two functions that write roles,
  `addMember` and `updateMemberRole`. Every path goes through those two: invitations, staff join codes and the member
  endpoints. It runs inside a transaction so two concurrent joins can't both take the last assistant slot.
- Fix the live bug where `transferOwnership` leaves the old owner as a second HEAD_COACH. The old owner becomes
  ASSISTANT_COACH. If 2 assistants are already taken, the transfer is **blocked** until a slot is freed (Karlos, 2026-09-27).
- Add a database safety net: a partial unique index on `team_memberships(teamId) WHERE role = 'HEAD_COACH'`. First run a
  read-only query on production to find existing violations and clean them up.
- Frontend: the role pickers hide HEAD_COACH and disable ASSISTANT_COACH once 2 are taken.

### Email verification
- Schema: add `User.emailVerifiedAt`, `emailVerificationTokenHash` and `emailVerificationExpiresAt`, mirroring the
  password-reset columns and reusing the `lib/passwordReset.ts` hashing pattern. Tokens expire after 24 hours.
- Registration sends a verification email through `lib/mailer.ts` with the link `${CLIENT_URL}/verify-email?token=…`.
- New endpoints: `POST /auth/verify-email` and `POST /auth/resend-verification` (rate limited).
- Gate these behind a verified email: accepting an invitation, redeeming a join code, claiming a player, and the add-member email lookup.
  Unverified users can still log in and use the app, and they see a banner asking them to verify.
- Frontend: a `/verify-email` page that mirrors `/reset-password`, the banner, and a resend button.
- Changing an email address clears `emailVerifiedAt` and sends a new verification email.
- **Every existing account starts unverified** (Karlos, 2026-09-27). No one is grandfathered in, and everyone has to verify.
- Karlos is setting up the email side in parallel: the production `CLIENT_URL`, the SMTP credentials, and a test with a real inbox.

---

## Phase 3: Tooling

Branch: `chore/tooling`.
1. Frontend lint: add `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh` with a minimal flat config.
   Fix the errors it reports or suppress them explicitly, with no mass reformat.
2. CI: add `.github/workflows/ci.yml` that runs on push and PR. It runs `npm ci` in both packages, `prisma validate`, `npm test`, `tsc` in both packages and the frontend lint.
3. Add security headers to `netlify.toml`: CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and HSTS.

## Phase 4: Tests for middleware and controllers
Sonnet writes plain `assert`-style tests for `middleware/auth.ts`, the permission middleware, and the C1, M1, coach-cap and
verification-gate paths. The pure logic is extracted where needed so tests don't import Prisma (see `CLAUDE.md`).

## Phase 5: Optional Ruflo trial
Runs only if Karlos says yes, following the handoff doc. The Ruflo MCP server currently times out on connect.

## Release
Open a PR from `develop` to `main` for Karlos to review. After his OK: back up the database, run `prisma migrate deploy`, then `.\deploy.ps1`.

---

## Removed (Phase 1A, branch `chore/remove-features`, 2026-09-27)

Restore point: git tag **`pre-feature-removal`** (the last `develop` commit that still had all of this). To bring a feature back,
check its files out from that tag and write a **new** migration. Don't revert the drop migration.

Decisions confirmed by Karlos on 2026-09-27:
- No league or video data in production was worth keeping.
- Leagues and video should come back much later, which is why this record exists.

**Backend (about 8,400 lines, 36 files deleted):**
- **Leagues:** `routes/league.ts`, `controllers/league.ts`, `services/league{Rankings,Standings,TeamProfile}.service.ts` and their tests. Also `requireLeagueCreator`, plus `leagueSeasonInclude`/`syncLeagueTeam` in `controllers/teams.ts`.
- **Video:** `routes/videos.ts`, `controllers/videos.ts`, `services/youtubeVideo.service.ts`, `services/videoStorage/` (the provider adapter, Supabase TUS proxy and README), and `lib/{videoClips,videoStatus,videoValidation,tusUpload,youtubeUrl}.ts` with their tests. Also `docs/design/video-storage-decision.md` and `video-sources-decision.md`, which record *why* video was designed the way it was. Read them from the tag before rebuilding video.
- **Assistant:** `services/assistant.service.ts` (rule-based Q&A) and `services/aiNarration.service.ts` (the Claude match summary). The `@anthropic-ai/sdk` dependency and `ANTHROPIC_API_KEY` were dropped.
- **Analytics extras:**
  - Files: `services/{opponentScouting,coachingRecommendations,trainingRecommendations,playerDevelopment,seasonIntelligence}.service.ts` and their tests, plus `lib/heatmap.ts`.
  - Endpoints removed from `controllers/analytics.ts`: heatmap and zone detail (match/team/player), `/matches/:id/zones`, advanced metrics, season intelligence, coaching and training recommendations, player development, rotations, momentum, the opponent report, the assistant ask and the report narrative.
  - Kept endpoints: match/team/player analytics, team trends, match report.
- **Scripts:** `smoke-invite`, `smoke-scoreboard`, `smoke-stabilization`, `smoke-team-join-codes`, `supabase-smoke`, `verify-chat`, `verify-chat-uploads`, `check-video-config`, `cleanup-pending-videos`, and the `check:video` npm script.
- **Env:** the `ANTHROPIC_API_KEY` block, the `VIDEO_*` block and the `SMOKE_PORT` note, all from `backend/.env.example`.
- **Tests:** the heatmap section of `lib/analytics.test.ts`, which tested an inline copy of the deleted code.

**Frontend (about 6,200 lines):**
- Pages: 8 league pages (`LeagueHub`, `LeagueSeason`, `LeagueSeasonStandings`, `LeagueSeasonRankings`, `Fixtures`, `Results`, `LeagueTeamProfile`, `MatchCentre`).
- Components: `components/league/`, `components/video/`, and in `components/analytics/`: `VideoPanel`, `AssistantPanel`, `OpponentScoutingPanel`, `CourtHeatMap`, `CoachingRecommendationsPanel`, `TrainingRecommendationsPanel`, `PlayerDevelopmentCard`, `SeasonIntelligenceCard`, `AdvancedMetricsPanel` and `RotationAnalytics`. Also `components/court/{CourtVisualization,HeatMapCourt}`, `components/charts/MomentumChart` and `lib/resolveFixture.ts`.
- The matching hooks, api functions (`leagueApi`, `videosApi`, the upload helpers, 19 `analyticsApi` members) and types were removed, along with the `tus-js-client` dependency.
- `config/features.ts` now only has `teamChat`.

**Database (migration `20260927120000_remove_leagues_and_video`, written but NOT yet applied):**
- Tables dropped: `leagues`, `league_seasons`, `league_teams`, `league_matches`, `videos`, `video_clips`.
- Enums dropped: `VideoStatus`, `VideoSource`, `ClipOrigin`.
- Column dropped: `teams.league_season_id`, with its index and FK.

**Kept deliberately (they look feature-specific but core uses them):**
- `momentum.service.ts` and `rotation.service.ts`, used by the match report.
- `lib/fileSignature.ts`, `@supabase/supabase-js`, `multer` and `image-size`, used by chat and feedback attachments.
- The `Event` columns `courtZone`, `rotationNumber`, `rallyNumber`, `isOpponentEvent` and `opponentJerseyNumber`.
- `recharts` and `chartColors.ts`.

**Added:** a catch-all route in `frontend/src/main.tsx` that redirects unknown URLs to `/`. Before this, they rendered a blank page, and removed-feature bookmarks would have too.

**Verified:**
- Backend `tsc` is clean and all 13 test files pass (27 before; the 14 deleted ones tested only removed features). `npm run build` works.
- Frontend `tsc` is clean and `vite build` works.
- In the preview, the login page renders and `/leagues` redirects.
- A full click-through was **not** possible, because the Supabase project is paused.

## Changed

### Phase 1B: security fixes (branch `fix/security`, stacked on `chore/remove-features`, 2026-09-27)

| ID | Commit subject | What changed |
|---|---|---|
| H4 | fix(deps) ×2 | `npm audit fix` in both packages. Backend: 0 advisories left. Frontend: axios fixed. **Open:** react-router has a moderate advisory that needs the v7 major (Phase 3). |
| C1 | scope member edit/remove | New `findTeamMembership(teamId, membershipId)` in `teamMembership.service.ts`; `updateMemberRole`, `updateMemberAccess` and `removeMember` now take `teamId` |
| H1 | never return join codes | Prisma `previewFeatures = ["omitApi"]` plus a global `omit` in `lib/prisma.ts`. Verified offline from the generated query protocol. `GET /players/:id` also narrows its team select. **Drop the preview flag when upgrading to Prisma 6.** |
| H2 | rate-limit auth | Login is limited to 10 per 15 min per email and 30 per IP; register to 5 per hour per IP; reset-password to 10 per 15 min per IP (`middleware/rateLimit.ts`) |
| L1 | equalise login timing | Unknown emails are compared against a precomputed dummy bcrypt hash. The register 409 is kept as a documented accepted risk. |
| L2 | logs | Removed the join code and email from the invitation warning and recipient addresses from the mailer logs; morgan logs `req.path` only |
| M1 | player team from record | `routes/players.ts` `requireRosterAccess` returns 400 when `body.teamId` doesn't match |
| M2 | player links | Also requires MANAGE_TEAM on the player's home team |
| M3 | recordEvent | The player must belong to the match's team, either directly or through a link |
| M4 | invite role cap | Adds `roleRank`/`canInviteRole` in `lib/rolePermissions.ts` with a test. HEAD_COACH can never be invited. |
| M7 (part 1) | admin from DB | New `isGlobalAdmin()`, used by `requireAdmin`, the feedback attachment check and chat moderation. **Part 2** (`User.tokenVersion`) moves to Phase 2. |
| M8 + L5 | consent and emails | Removed `POST /teams/:id/members`, `GET /users/search`, `searchUsers`, `userLookupRateLimit`, `useAddMember`/`useUserSearch` and `UserSearchResult`. The members card now shows "+ Invite staff" (staff code plus email invite). Emails are only returned to MANAGE_MEMBERS holders. |
| L3 | self-approval | Blocked, except for the owner |
| L4 | claim player | Only PLAYER-role members can claim, one linked record per team. There's no invitation-to-player link in the schema to match on. |
| L6 | profile image | `lib/profileImage.ts` (with a test) only allows the Supabase host. The Profile page's free-text URL field was removed (there is no avatar upload yet). |

M5 and M6 were resolved by Phase 1A (the code was deleted). H3 (email verification) is covered in Phase 2.

**Found along the way, for later phases:**
- Every async Express middleware (`requireTeamPermission`, `requireTeamAccess`, `requireAdmin`, …) has no try/catch. A database error leaves the request hanging until the Lambda times out instead of returning a 500. Fix it once, for every route (Phase 4).
- Existing external `profileImage` values stay in the database and are still shown. Clear them in Phase 2's migration.
- L4 edge case: a player who joined with a code already has an auto-created roster row, so they can't claim a separate, older coach-created row that holds their history. Merging the two would need a coach-side tool.
- The Supabase project was **paused** on 2026-09-27, so the production API is down until it's restored.

### Phase 2: roles and email verification (branch `feat/roles-and-verification`, stacked on `fix/security`, 2026-09-27)

Before any code was written, production (Supabase, read-only) held 2 users, 1 team, 0 league/video rows, and no HEAD_COACH or assistant-cap violations.

| Area | What changed |
|---|---|
| Migration `20260927130000` | Adds `users.email_verified_at`, `email_verification_token_hash`, `email_verification_expires_at` and `token_version` (default 0), plus the partial unique index `team_memberships_one_head_coach` on `(team_id) WHERE role = 'HEAD_COACH'`. **Not applied.** |
| Coach rule | `lib/roleSlots.ts` (pure, with a test). `withRoleSlot` in `teamMembership.service.ts` wraps `addMember` and `updateMemberRole` in a SERIALIZABLE transaction and maps P2034 to 409. HEAD_COACH is removed from the `VALID_ROLES` the controller accepts. The head coach can't be demoted or removed. Re-saving the same role is a no-op (it used to re-seed the tiers). |
| Ownership transfer | `teamOwnership.service.ts` now runs in one transaction: the old owner is demoted to ASSISTANT_COACH, then the new owner is promoted with the matching default tiers, then `ownerId` is updated. It returns 409 if the old owner would be a third assistant. `syncOwnerMembership` is now only used at team creation. |
| Email verification | Adds `lib/emailVerification.ts` (24 h TTL, reuses `hashResetToken`), `services/emailVerification.service.ts` (`issueVerificationEmail`, `verifyEmail`, `resendVerification`, `assertEmailVerified`) and `mailer.sendVerificationEmail`. Endpoints: `POST /auth/verify-email` and `POST /auth/resend-verification`. The gate (403 `EMAIL_NOT_VERIFIED`) is on invitation accept (both paths), join-code redeem and player claim. `AppError` gains an optional `code`. There's no email-change endpoint anywhere, so nothing needed re-verifying. |
| Token revocation (M7 part 2) | JWTs carry a `tv` claim, and `requireAuth`/`optionalAuth` compare it to `users.token_version` on every request. A missing `tv` counts as 0. `resetPassword` increments the version. There's no separate change-password path. Both middlewares now send DB errors to `next(err)`. |
| Frontend | `/verify-email` page, `EmailVerificationBanner`, `ResendVerificationNotice` on all three join flows, HEAD_COACH removed from `ROLE_OPTIONS`, ASSISTANT_COACH disabled once 2 are taken, per-row role-change errors, and a 401 interceptor that clears the token and goes to `/login`. |

**Verified:**
- Backend `tsc` is clean, all 18 test files pass (3 new), and the backend builds.
- Frontend `tsc` is clean and `vite build` works.
- In the preview, `/verify-email` with a bad token shows the failure state. This caught and fixed a StrictMode bug where the page stayed on "Verifying".
- **Not** tested end to end against a database, because production doesn't have the new columns until the migration runs. After deploying, walk through: register, receive the email, click the link, the banner disappears, then join a team.

**Still open:**
- About 7 older controllers catch `err.statusCode` themselves and skip the shared error handler. Harmless today, but they would drop a future error `code`.
- Serializable transactions on pgbouncer are expected to work in transaction mode, but that's unverified until production.

### v9.3.0: observability follow-up (2026-09-28)

A separate review session built branch `fix/phase2-observability` ("Phase 2.2"). Claude Code checked every claim against the code and the live site and kept all of it:
- `/health` checks the database.
- Browser navigation breadcrumbs are scrubbed. This was a real leak of join codes and tokens.
- Each function invocation gets its own Sentry scope, request data and root span.
- An admin-only Sentry end-to-end check on the Feedback page.
- `netlify.toml` is tracked again, by Karlos's decision after it was raised twice.

Its criticism was fair: the VOLLEYVISION-1 test was a hand-sent event (SDK `audit-check`), so it didn't prove the app's own SDK or its scrubbing.

Claude Code added:
- **Backend breadcrumb scrubbing:** `instrument.ts` only covered request data and spans.
- **Node 24 across `.nvmrc`, CI, `netlify.toml` and `engines`:** the live function ran `nodejs24.x`, confirmed through the Netlify API.
- **Netlify `stop_builds: true`:** Karlos's decision. With the GitHub link active, a merge to `main` had auto-published a build that skipped the migration check.
- **Local only:** `frontend/.env.local` now points at the live Sentry project.

**Coordination note:** that session checked out its branch in the same working copy Claude Code uses. Run one agent at a time per working copy.

### Audit closed (2026-09-27)

Phases 0–4 are complete. **Phase 5 (the Ruflo trial) was dropped** at Karlos's decision: it was mostly about Ruflo, whose MCP server never connected in this session, and the audit didn't need it.

**Final state:**
- **Releases:** `v9.0.0` (Phases 1A, 1B, 2), `v9.1.0` (Phases 2.1, 3) and `v9.2.0` (Phase 4), all deployed.
- **Code health:** CI runs on every PR, and both packages have 0 production vulnerabilities.
- **Tests:** 31 backend test files, covering every audit security fix.
- **Supabase advisors:**
  - Security: 20 INFO findings, all the intended "RLS with no policies" default-deny. No action.
  - Performance: 32 INFO "unused index" findings, expected with 2 users and 1 team. Keep them; they'll be used as data grows.

- **Greptile:** it only ever reviewed #7 and #9, because its trial had ended before #4–#6 and #10–#13. All 11 findings from those two reviews are fixed (9 in #10, 2 in #13), so nothing urgent is outstanding.

**Left for later:**
- Express 5 upgrade (needs the `req.params` typing work).
- Move `teamJoinCode` and `invitation` services from `Object.assign(new Error)` to `AppError`.
- A full pass over the non-urgent Greptile comments.
- A real avatar upload.
- The Sentry test button, which belongs on the Feedback page.
- Source-map upload, once Karlos sets `SENTRY_AUTH_TOKEN` as a local Windows user variable.
- Karlos to re-authorize Netlify's GitHub access.

### Release v9.1.0 and Phase 4 (2026-09-27)

**v9.1.0 release:**
- #10 was merged (its branch kept), then #11 was retargeted to `develop` and merged, then #12 took `develop` to `main`. Tag `v9.1.0` is on `4cfb687`. Tag `v9.0.0` was added on `2bc83eb`, the earlier release.
- Deployed with the fixed `deploy.ps1`.
- Live checks: API healthy, all 6 security headers served, no CSP violations on the login page, and Karlos's screenshots of the dashboard charts and tables render correctly. No source maps are public.
- Sentry now reports to `volleyvision` (test issue VOLLEYVISION-1 arrived).

**The Sentry source-map upload fails with 401. Root cause:** the Netlify CLI passes secret env vars to local builds as a literal `*******`, and that masked value even overrides the shell. So `deploy.ps1` can never receive a Netlify-stored secret. The fix, done by Karlos: delete `SENTRY_AUTH_TOKEN` from Netlify and set it as a Windows user environment variable.

**Supabase security advisor:** 20 INFO findings, all "RLS enabled, no policies". This is intentional. RLS with no policies means default-deny for the Supabase Data API, and the backend connects as the owner role, so it isn't affected.

**Phase 4 (branch `test/phase4`):**

| Item | Change |
|---|---|
| Hanging requests | Adds `middleware/asyncHandler.ts`, applied to the 8 guards in `permissions.ts` plus `requireCreateMatch`, `requireManageLinkedTeam`, `requireRosterAccess` and `requireTrackForBodyTeam`. `visibility.ts` and `teamOwner.ts` already caught their own errors. An Express 5 upgrade was tried and reverted: `@types/express` 5 types every `req.params` value as `string | string[]`, which produced 129 type errors. |
| Error handling | Adds `lib/mapError.ts` (`mapErrorToResponse`, with a test), used by `errorHandler`. It honours `statusCode` and `code` on any Error. The 11 shortcut catches in the invitation, playerPortal, profile and teamJoinCode controllers are now `next(err)`. |
| Test harness | Adds `src/testing/fakePrisma.ts` (a Proxy with explicit stubs and call recording) and `installFakePrisma.ts` (a `require.cache` swap). `run-tests.js` also runs `src/__tests__`. |
| Tests | 10 new files, 31 total. The mutation check passed: dropping `teamId` from `findTeamMembership`'s where makes the C1 test fail. |
| Greptile minors | The verify page runs once per token, and a refresh failure after success is ignored. Role pickers are filtered by `canInviteRole` (frontend mirror in `lib/teamRoles.ts`). The README clarifies the second terminal for the frontend. |

**Later:**
- Upgrade to Express 5 (it needs the `req.params` typing work).
- `teamJoinCode.service` and `invitation.service` throw plain `Object.assign(new Error, {statusCode})` instead of `AppError`. They work, but it's inconsistent.

### Phase 3: tooling (branch `chore/tooling`, stacked on `fix/greptile-findings`, 2026-09-27)

| Item | What changed |
|---|---|
| CI | Adds `.github/workflows/ci.yml` with separate backend and frontend jobs on Node from `.nvmrc`. Uses placeholder DB URLs, so no secrets are involved. The audit step fails on `--audit-level=high`. |
| Lint | Adds `frontend/eslint.config.js` (ESLint 9 flat config: `@eslint/js` + `typescript-eslint` + `react-hooks` + `react-refresh`). Typed axios error helpers (`getApiErrorMessage`, `isRateLimitedError`) replace `any` casts. 11 suppressions, each with a reason: 9 `react-refresh/only-export-components` and 2 `no-explicit-any`. |
| Headers | Adds `frontend/public/_headers` (CSP, XFO, nosniff, Referrer-Policy, Permissions-Policy, HSTS). **Any new external origin must be added to the CSP.** Tested on a local server applying the same headers: the login and register pages show no violations. Pages behind login still need checking on the live site. |
| react-router | 6 → 7.18.4. No route code changes were needed. Production audit is now 0 in both packages. |
| Source maps | `@sentry/vite-plugin` runs only when `SENTRY_AUTH_TOKEN` is set at build time. Maps are uploaded, then deleted by `filesToDeleteAfterUpload`. **Needs Karlos:** a Sentry auth token in the Netlify env. |
| deploy.ps1 | The deploy step now uses the same Continue plus exit-code guard as the migration check. |

**Sentry finding:** production's DSNs point at two older projects (backend `…0620160`, frontend `…6453376`). Both accept events, but Karlos's dashboard and the connector only show the new `volleyvision` project (`…7605504`). Both DSNs were repointed to `volleyvision` on 2026-09-27 (Karlos approved), and `SENTRY_AUTH_TOKEN` was added to Netlify for source maps.

**Local-only files hazard:** switching from a branch that tracks `CLAUDE.md` and `netlify.toml` to one that doesn't deletes the working copies. Backups are in `.claude/local-config-backup/`.

### Deploy and Phase 2.1 (2026-09-27)

**Release:**
- PRs #4, #5, #7 and #8 were merged into `develop`, then `develop` was merged into `main` (#9).
- Both migrations were applied to production and the site was deployed with `deploy.ps1`'s command. The script crashes under PowerShell 5.1 on npm's stderr warnings; that fix is part of Phase 3.
- Checks on the live site: `/health` is OK, a bogus login returns 401, the new endpoints respond, the removed routes return 404, and the live JS bundle contains the new pages.
- Karlos received the verification email, so SMTP works end to end.

**Environment and repo settings:**
- `SMTP_HOST=smtp.gmail.com` was missing from Netlify. Production had never sent any email before this.
- The Netlify repo link was moved from `karlos-h` to `himex-cyber`. Netlify's GitHub access still needs re-authorizing in the UI: git-triggered builds now fail to clone, which is harmless because deploys come from `deploy.ps1`.
- PRs are now opened from the `himex-cyber` account.

**Security and monitoring:**
- The secret scan of the full git history found **no secret ever committed**. The only credential-like strings are the two Sentry DSNs, which are public by design.
- Sentry works: the backend and frontend DSNs point at two projects in the `himex-cyber` org, and both accepted a test event. **Open:** the Sentry connector can only see one project, and source maps aren't uploaded yet (Phase 3).

**Phase 2.1 (branch `fix/greptile-findings`):** fixes for the nine findings from Greptile's review that were real and still on `main`.

| Finding | Fix |
|---|---|
| Queued invitation used a stale inviter role | `applyCreateInvitation` re-checks `canInviteRole` against the requester's current role |
| Email HTML injection | Adds `lib/escapeHtml.ts` (with a test), applied to every user-supplied value in `mailer.ts` |
| Role edit or removal racing ownership transfer | The HEAD_COACH re-check runs inside the transaction. `runSerializable` in `lib/prisma.ts` and `isSerializationConflict` (with a test) replace ad-hoc P2034 handling |
| Double player claim | Check and claim run in one serializable transaction |
| Ownership transfer returned 500 on a conflict | Now goes through `runSerializable`, which returns 409 |
| Non-atomic registration | The token is minted before `user.create` and saved in the same write |
| Tokens could be consumed twice | Verification and reset both use a conditional `updateMany` plus a `count` check |
| Reset email fired and forgotten | The send is awaited, and the floor rises from 1.2s to 4s |
| A wrong password logged out a valid session | The token is never attached to credential endpoints |

Also in Phase 2.1: `CLAUDE.md` and `netlify.toml` were untracked (Karlos's decision) and `.gitignore` now covers every `.env*`. The minor Greptile items (two verify-page edge cases, README wording) are deferred to the full Greptile pass.

Verified at the end of Phase 1B: backend `tsc` is clean, all 15 test files pass (2 new), and the backend builds; frontend `tsc` is clean and `vite build` works.

### Phase 2.2: observability close-out (branch `fix/phase2-observability`, 2026-09-27)

Why: the handoff's Phase 2 goal was to prove observability end to end, and it had not been met. The one event in Sentry
(`VOLLEYVISION-1`) reports `sdk.name: audit-check`: a script sent it, not the app, so it proved the DSN, the project
and the alert email, but not that the deployed browser bundle or API report errors, nor that the scrubbing works. There
had been zero transactions in 7 days despite 10% sampling. `/health` never touched the database, and no uptime monitor
existed any more.

| Change | Where |
|---|---|
| `/health` pings the database (`SELECT 1`, 5 s bound) and returns 503 when it can't. Tested helper. | `lib/dbHealth.ts` (+ test), `index.ts` |
| Browser scrubber also strips `from`/`to` on navigation breadcrumbs | `frontend/src/main.tsx` |
| Each invocation runs in its own Sentry isolation scope, with method + path-only URL as request data and a root `http.server` span (cuid path segments folded to `:id`); the flush moved into a `finally` | `backend/netlify-functions/api.js` |
| Admin-only Sentry check: `POST /api/v1/feedback/sentry-test` (requireAuth + requireAdmin + 10/hour per user) always fails; the card also throws an uncaught browser error. Both plant a probe query string. | `routes/feedback.ts`, `middleware/rateLimit.ts`, `components/feedback/SentryTestCard.tsx`, `FeedbackPage.tsx`, `lib/api.ts` |
| `netlify.toml` tracked again (Karlos, 2026-09-27); its comment no longer claims `NODE_VERSION` pins the function runtime | `.gitignore`, `netlify.toml`, `frontend/public/_headers`, `README.md` |

**Found along the way:** the browser scrubber only cleaned a breadcrumb's `url`. Sentry records every URL change as a
navigation breadcrumb with `from` and `to`, query string included. A visit to `/redeem-invitation?code=…` (a reusable
team join code), `/reset-password?token=…` or `/verify-email?token=…` therefore put that secret into every later error
event from the same session. Fixed above; the probe test covers it.

**Verified:** backend `tsc` clean, 32/32 test files (1 new), no import cycles, `node --check` on `api.js`; frontend `tsc`
clean, lint clean.

**Live check after deploy** (the part that closes Phase 2):
1. `GET /health` returns `{"status":"ok","db":"ok"}`.
2. Signed in as the admin, open Feedback and press both buttons.
3. In Sentry, two new issues arrive: the browser one with `sdk.name` `sentry.javascript.react`, and the API one with
   `sentry.javascript.node`, whose request shows `POST` and a path-only `/api/v1/feedback/sentry-test`.
4. PASS only if `sentry-probe-should-not-appear` occurs nowhere in either event's JSON (request URL, breadcrumbs, spans),
   and neither shows an `authorization` or `cookie` header or a request body.

**Still open:** recreate the Sentry uptime monitor on `/health` once this is deployed; the full security review after the
subagent spend limit resets (2026-09-28 18:00 UTC); choose one Node version (the live function runs 24; `.nvmrc`, CI and
`netlify.toml` say 22).

### Phase 0 of the rebuild roadmap (branch `chore/phase0-clean-base`, 2026-09-28)

Why: the roadmap (`VolleyVision-Roadmap-to-Beta.md`) rebuilds the app feature by feature from v9.2.0,
and starts from a clean, released base. Karlos decided on 2026-09-28 to remove the training-session
routes rather than build a UI for them now.

The observability half of Phase 0 had already shipped as v9.3.0, with fixes in v9.3.1 and v9.3.2, so this
release carries only the removal. Karlos ran the Sentry probe check after v9.3.1 and set up the uptime
monitor on `/health`, which closes those two items above.

| Change | Where |
|---|---|
| Training-session API removed (table, `Event.trainingSessionId` and `ownEventsOnly` kept) | `routes/`, `controllers/`, `services/trainingSession.service.ts`, `index.ts` |
| v9.4.0 released: the removal | `CHANGELOG.md` |

**Verified:** backend `tsc` clean, 32/32 test files, no import cycles (131 files), build OK; frontend `tsc` clean,
lint clean, build OK.


### Phase 1 of the rebuild roadmap: staging and the verification toolchain (branch `rebuild/p1-staging-toolchain`, 2026-09-28)

Why: every later phase must be proven before it reaches real teams. That needs a staging copy of the app, and CI
that catches schema drift, missing RLS and authorization regressions by itself.

Karlos's decisions for this run: the release is v9.5.0 (Phase 0 took v9.4.0). Nothing is deployed and no migration is
applied anywhere while Netlify credits are low. So staging creation (Part C1), applying the RLS migration (C2) and the
staging and production smoke checks are **deferred**, and this phase is released as merged and tagged only.

| Change | Where |
|---|---|
| RLS on every public table + revoke anon/authenticated grants, guarded for plain Postgres (**not applied**) | `prisma/migrations/20260927221052_enable_rls_all_public_tables` |
| `SENTRY_ENVIRONMENT` / `VITE_SENTRY_ENVIRONMENT` override | `instrument.ts`, `main.tsx`, `.env.example` files |
| Staging seed; refuses any non-staging database (prod ref held in `lib/stagingGuard.ts`, tested) | `scripts/seed-staging.ts`, `lib/stagingGuard.ts` |
| Integration runner (localhost-only, credentials pinned) and harness | `scripts/run-integration-tests.js`, `src/__integration__/harness.ts` |
| authz matrix (47 routes x outsider/viewer/player, 35 caller cases pinned as `TODO(P2)`) and RLS check | `src/__integration__/*.test.ts` |
| Fast HTTP layer over fakePrisma; unit runner pins a dead `DATABASE_URL` and blank Sentry/SMTP/Supabase | `src/__tests__/http.routing.test.ts`, `scripts/run-tests.js` |
| CI `db` job: postgres:17, migrations from zero, `migrate diff --exit-code`, integration tests | `.github/workflows/ci.yml` |
| Smoke check | `scripts/smoke.mjs` |
| `deploy.ps1 -Target staging\|prod`: prod refuses dirty/non-main without `-Force`; staging refuses prod ids; smoke after deploy | `deploy.ps1` |
| Docs | `README.md`, `backend/.env.staging.example`, `.gitignore` |

Deviations from the handoff:
- CI uses postgres:17 to match prod (17.6), not 16.
- No drift allowlist. Prisma 5.22's diff ignores the partial index `team_memberships_one_head_coach`, so the diff is
  empty. Verified that an added column makes it exit 2.

**Gaps the authz matrix pinned for Phase 2:**
- Outsiders get 403, not 404, on staff reads, every write and chat.
- `GET /teams/:id/my-role` answers an outsider 200.
- `GET /analytics/players/:id` is open to every member.
- The forgot-password global limiter runs first (defect 3).

**Verified** (in this session):
- Backend: `tsc` clean, 34/34 unit test files, no import cycles, build OK.
- Frontend: `tsc`, lint and build clean. `npm audit --omit=dev --audit-level=high` is clean in both packages.
- Against a throwaway local PostgreSQL 18 cluster:
  - every migration applies from zero, and 20/20 tables have RLS
  - the drift check is empty
  - integration tests pass 2/2
  - the staging seed runs twice cleanly
  - the full smoke check passes, including the logged-in checks
- `smoke.mjs` read-only against prod: PASS.
- Reviews: `/code-review high` raised 7 findings. 6 were fixed; the runner duplication was kept, because the handoff
  asks for a copy. The independent Opus review raised 1 medium and 2 low findings, all fixed: the unit runner's
  database pin, the staging deploy refusing prod ids, and the missing chat-upload row.

**Deferred until deploys resume:**
1. Karlos creates staging (Part C1).
2. Apply the RLS migration to staging, check the advisor, back up prod, then apply it to prod.
3. Seed staging.
4. `deploy.ps1 -Target staging`, then a prod deploy with its smoke check.

### Phase 2 of the rebuild roadmap: security hardening (branch `rebuild/p2-security-hardening`, 2026-09-28)

Why: close every authorization, rate-limit and reliability defect the roadmap confirmed in code before real teams
use the app. Players can be minors.

Karlos's decisions:
- Released as v9.6.0.
- Approved per phase, not per item.
- Not deployed. The staging two-browser check (Part C4) is deferred until deploys resume.
- 2026-09-28: fix every minor review finding in the phase that raised it, rather than carrying it forward.

| Defect | Fix | Test (fails before) |
|---|---|---|
| 1. Staff join code | Returned only at FULL_ACCESS on invitations; can't grant MANAGER | `teamJoinCode.test.ts`, matrix role checks |
| 2. Team delete | Owner only (`requireTeamOwner` mounted) | `http.teamDelete.test.ts` |
| 3. Forgot-password limiters | Per-IP/email before global | `http.routing.test.ts` |
| 4. Unlink guard | URL teamId wins; mismatching body 400 | `http.teamLinkGuard.test.ts` |
| 5. Approvals | Atomic claim (`updateMany where PENDING`), revert on failed apply | `approvalAtomic.test.ts` |
| 6. Player analytics | Scoped to one team; staff, admin or the player only; no home-team id leak | `playerAnalyticsScope.test.ts`, matrix |
| 7. Low severity | SMTP timeouts; invitation limiter (20/h per user); email normalised before dup check; event-write limiter (600/10 min per user); chat 404; non-string email 400; audit limit clamp | `http.hardening.test.ts`, `invitationDuplicate.test.ts` |
| Outsiders get 404 | Visibility before role in every team-scoped guard (one owner+membership lookup), `my-role` gated, resource-specific not-found wording | `permissions.test.ts`, authz matrix (no TODO(P2) left) |

Deviations and extras:
- The invitation limiter is per user only. A shared per-team bucket let one member block the head coach.
- Frontend: player dashboards take `?teamId`. Links into them show only for staff or the player's own records, and the
  tab bars are staff-only.
- Clean-up of findings carried over from earlier phases:
  - both test runners share `scripts/test-runner.js`
  - the `eventFilters.ts` comment no longer names removed features
  - `CLAUDE.md` says Node 24
  - the stale `gh-https` remote is removed, and merged local branches whose remotes were gone are deleted

**Reviews:**
- `/code-review high` raised 6 findings, all resolved:
  - Fixed (4): duplicate DB reads in the guards; the multer error handler (it turned DB errors into a 400); the
    404 wording that revealed whether an id existed; players unable to open their own row.
  - Fixed (1): the access tier read twice on the join-codes route.
  - No change needed (1): sign-up now requires a full address. The CHANGELOG says so.
- Independent Opus review: PASS, with 1 medium and 5 low findings, all fixed.
- `/security-review`: no findings.

**Verified:**
- Backend: `tsc` clean, 40/40 unit test files, no import cycles, build OK.
- Frontend: `tsc`, lint and build clean. `npm audit --omit=dev --audit-level=high` is clean in both packages.
- Integration tests against Docker postgres:17 pass 2/2; the authz matrix covers 48 routes x outsider/viewer/player,
  plus role checks.

**Deferred until deploys resume:**
- The staging two-browser check (Part C4).
- The prod deploy with its smoke check.

### Phase 3 of the rebuild roadmap: responsive core screens (branch `rebuild/p3-responsive-core`, 2026-09-28)

Why: the tracking page, scoreboard, match and team dashboards and the app chrome must work on a 360px-wide phone,
ready for the mobile app in Phase 5.

Karlos's decisions:
- Released as v9.7.0, not deployed.
- The six units (U1–U6) ran as parallel worktree subagents with disjoint file ownership and were merged into the
  phase branch, instead of six PRs.

Finding: the app has only a light theme. `darkMode: 'class'` is configured but nothing ever turns it on, so gate 7
("light and dark") reduces to "don't break light, add no `dark:` classes".

| Unit | Change |
|---|---|
| U1 Tracking | Toggles, jersey input, Recent chips, and the keep-zone row are 44px; the event grid is 2 columns below `sm` (from `sm` up it's driven by a `--slots` CSS variable) |
| U2 LiveScoreboard | Set buttons 44px; Undo/End Set/Reset controls 44px; score and centre shrink below `sm`; team names truncate |
| U3 Match dashboard | `navy-300` on white cards changed to `grey-600` (contrast); team names truncate; Copy Report is 44px and its legacy classes are replaced |
| U4 Team dashboard | Same contrast fix; legacy classes replaced in the charts and insights; leaderboard labels shortened so all five show; insight text uses `.strong` on tints |
| U5 Layout | Header controls and logo links are 44px; the signed-out header fits 360px. The dead "chrome-free" `/track/` branch is removed: tracking stays in the shell, because it relies on `<main>`'s padding |
| U6 Match header, sub-navs | Back button, status trigger and menu options, Dismiss, and every tab are at least 44px; the long-title `h1` wraps |
| Test helper | `testing/testEnv.ts`: an http test run directly (not through `npm test`) pins the runner's safe env, so it can't reach `backend/.env` credentials or leave a stray `:3001` listener |

**Verified in a browser:** every Phase 3 screen was checked at 360x800 against the local Docker Postgres with staging
seed data. Page width stayed at 360, and every visible control measured at least 44x44 in the page. At 1024px, desktop
layouts are unchanged (the tracking grid is back to its 5/3/3/3/2/2 columns).

**Reviews:**
- `/code-review high`: 1 finding (the chrome-free guard stripped the tracking page's padding), fixed.
- Independent Opus review: no high findings; 1 medium and 2 low, all fixed.
- `/security-review`: no findings.

**Verified:**
- Backend: `tsc` clean, 40/40 unit test files, no import cycles, build OK.
- Frontend: `tsc`, lint and build clean.
- Integration tests pass 2/2.
- `npm audit`: clean in both packages.
- No legacy classes remain in the Phase 3 files.

**Housekeeping:**
- The six unit worktrees and their merged branches are removed.
- Test-process hygiene: a stray test server on `:3001` was traced to directly-run http tests and fixed (`testEnv`).
- In this session, the variable NAMES in `backend/.env` were printed once while diagnosing that (no values). From now
  on the rule holds: no `.env` reads.

**Deferred until deploys resume:** the phone check on staging (Part C5), and the prod deploy with its smoke check.

### Production deploy: v9.4.0–v9.7.0 (2026-09-28)

Karlos approved deploying and applying the pending RLS migration without a separate backup. On prod the migration
changed no data: RLS was already on for all 20 tables, so only the default anon/authenticated grants were revoked,
and one `GRANT` undoes that.

1. Before: 20/20 public tables had RLS; the anon/authenticated roles held grants on 20 tables; migration history was
   clean up to `20260927130000`.
2. `npx prisma migrate deploy` applied `20260927221052_enable_rls_all_public_tables`, and `migrate status` reported
   up to date. After: 0 tables without RLS, and 0 anon/authenticated grants. The Supabase security advisor shows only
   the expected INFO notice ("RLS enabled, no policy", 20 tables), with no warnings or errors.
3. `deploy.ps1` ran from a clean `main` at `61f18fc` (tag v9.7.0), with the Netlify CLI signed in as
   himextradingltd. Deploy message: "v9.7.0 (61f18fc) …".

**Live checks:**
- The built-in smoke check passed: `/health` reports ok and db ok, the CSP header is present, and an unknown team
  returns 404 without a token.
- `/api/v1/training-sessions/by-team/x` returns 404, so the v9.4.0 removal is live (v9.3.2 answered 401).
- A login with a numeric email returns 400, so the v9.6.0 input fix is live (v9.3.2 answered 500).
- The production bundles contain the v9.6.0 player-dashboard message and the v9.7.0 tracking grid.
- Sentry shows no unresolved issues in the 24 hours after the deploy.

**Still for Karlos, signed in on a phone:**
- Dashboard, a team, a match's stats, team chat.
- Start a match and tap through a rally on the tracking page.
- As an assistant coach, confirm there is no staff code.

Staging is still not created: Part C1, the next phase.

### Phases 4.0 and 4 of the rebuild roadmap: carry-over fixes, court zones and heat maps (branches `rebuild/p4-0-carryover`, `rebuild/p4-heat-maps`, 2026-09-28)

Why: an independent review of v9.3.0–v9.7.0 found the per-player data rule applied only to the player page, and
that any player could claim a teammate's record. Phase 4 then brings back court-zone heat maps from data tracking
already records. Released together as v9.8.0. No migration.

| Item | Change | Test (fails before) |
|---|---|---|
| 4.0.1 Per-player rule | Match/team analytics, the match report and the event log give non-staff team totals plus only their own row (`lib/playerPrivacy.ts`, `seesEveryPlayer`); UI shows "Your Stats" | `playerPrivacy.test.ts`, `playerPrivacyEndpoints.test.ts`, matrix shape checks |
| 4.0.2 Record claims | Self-claim/unlink answer 403; staff link/unlink via `POST/DELETE /teams/:id/players/:playerId/link` (MANAGE_MEMBERS, rate-limited, serializable) | `http.playerRecordLink.test.ts`, matrix rows |
| 4.0.3 Deploy | Prod always passes `--site` | — (script) |
| 4.0.4 Harness guard | `lib/localDb.ts` + `requireLocalDb` first import; a direct run is refused | `localDb.test.ts` |
| 4.0.5 Grants | CI creates Supabase roles before migrating; `rls.test.ts` asserts no anon/authenticated grants | proven on a throwaway local DB (fails on a table without REVOKE) |
| 4.0.6 Sentry | Join codes and invitation tokens folded out of URLs (`lib/scrubUrl.ts`, browser copy) | `scrubUrl.test.ts` |
| 4.0.7 Chunk reload | No reload when storage is blocked | — |
| 4.0.8 Matrix | Portal, `/users/me`, invitation and attachment routes, anonymous spot checks; no leaks | matrix (68 routes) |
| 4.1 Heat map | `lib/heatmap.ts` ported, with coverage `{ tagged, total }` | `heatmap.test.ts` (real function) |
| 4.2 Scope | `resolvePlayerScope` shared by player stats and the player map | `playerAnalyticsScope.test.ts` unchanged |
| 4.3 Routes | `/analytics/{matches,teams}/:id/zones` (all members), `/analytics/players/:id/zones` (staff/self) | `zoneRoutes.test.ts`, matrix (72 routes) |
| 4.4–4.6 UI | Hooks, `CourtHeatMap` (restyled, 360px, 44px tabs, aria-labels, coverage), wired into three dashboards; report links to the map | browser check |

Deviations:
- `VALID_ZONE_FILTER` was not carried over: queries use no zone filter so coverage can count untagged rows.
- In the event log, notes are also hidden from non-staff on own-team events with no player (stricter than the spec).
- The dashboard sections are not lazy-loaded individually (no section is); each page is a lazy route chunk, and
  `CourtHeatMap` is its own 4.2 kB chunk, not in `/login`'s initial chunks.

**Browser check** (local Docker DB with staging seed, 360x800 and 1280): width stays 360, tabs 44px, square cells;
seed attack counts per zone match SQL; the empty state shows on an untagged match; as the seed player, team and match
dashboards show only their own row, the event log names only their own events, and a teammate's map and stats are
refused.

**Reviews:**
- `/code-review high`: 10 findings, 9 fixed (report highlight counts tips/free balls like the map; the guard hands
  the team id on; the staff rule reused; link 409 names the existing record; undefined colour classes and contrast;
  fewer wasted requests), 1 parked for Karlos (players on a team only via `PlayerTeamLink` have no own row; staff
  tables also omit them).
- Independent Opus review: no high or medium; 6 low, 4 fixed, 2 for the G2 review (link routes check role, not the
  roster access tier, like the member routes; the heat-map CHANGELOG bullet was added).
- `/security-review`: nothing at or above the reporting threshold. One candidate (7/10): home-team staff can now
  unlink a claimed record and link it to another member, whose player portal then showed that record's stats from other
  teams (the portal read by `userId` across teams; the unclaimed-record path existed before). **Karlos (G2): scope the
  portal.** Every portal read now counts only matches of teams the viewer owns or belongs to (`portalScope`,
  `playerPortalScope.test.ts`). Karlos also kept the link routes on role only (like the member routes) and parked the
  linked-player rows for a later phase.

**Verified:** backend `tsc` clean, 49 unit test files, build OK; frontend `tsc`, lint and build clean; integration
2/2 (matrix 72 routes).

### Production deploy: v9.8.0 (2026-09-29)

Karlos approved the G2 review of 4.0.1, 4.0.2 and the portal scoping, and the deploy, on 29 Sept.

1. PRs #31 (Phase 4.0) and #32 (Phase 4) merged into `develop` after `develop` (with #33, the grey-token clean-up)
   was merged into the Phase 4 branch and its CI passed on the combined code. Release PR #30 merged to `main` (CI 6/6);
   tag `v9.8.0` on `3dc31b9`.
2. Before deploying: working tree clean, `main` = `origin/main` = the tag, no code difference from the branch the full
   local check suite passed on (49 unit test files, integration 2/2 with 72 routes, `npm audit` clean in both), and
   no new migration. Netlify CLI signed in as himextradingltd, site volleyvision-app.
3. `deploy.ps1` (prod, now with `--site`): migration check OK, build, publish; its smoke check passed (health ok and db
   ok, CSP header, unknown team 404).

**Live checks:**
- `POST /api/v1/teams/x/players/y/link` without a token answers 401: the 4.0.2 staff route exists (v9.7.0 had none).
- `GET /api/v1/analytics/matches/x/zones` answers the visibility guard's JSON "Match not found." (an unknown route
  gets the SPA's HTML), so the zone routes are live.
- The production bundle contains the 4.0.6 Sentry URL folding.
- Sentry: no issues since the deploy. The two open issues (VOLLEYVISION-5 and -6) date from 28 Sept, right after the
  v9.7.0 deploy: a tab left open across it loading an old chunk.

**For Karlos (Part C5):** regenerate each team's staff join code (Invitations tab), check the members list for any
Manager who shouldn't be one, and on a phone: a team dashboard (court zones), a match's stats, the roster's
Link/Unlink, and as a player account that only your own stats show.

### Phase 4.5 of the rebuild roadmap: per-team roles (branch `rebuild/p4-5-team-roles`, 2026-09-28/29)

Why: Karlos decided (28 Sept) there is no global "coach" or "player" account type. Anyone can create a team and is
its coach; your role on each team decides what you can do there. Every server check was already per team; the
frontend's global mode clamped a coach's permissions on every team. Released as v9.9.0. No migration.

| Item | Change | Test (fails before) |
|---|---|---|
| 4.5.1 | `ViewModeContext`, the header toggle, the `useTeamRole` clamp, `PLAYER_VIEW_PERMISSIONS` and `MatchPageHeader`'s view-mode term removed; stale `vv_view_mode` key cleared once | browser check |
| 4.5.2 (G2) | `createTeam` no longer refuses `signupIntent` PLAYER; `teamCreateRateLimit` 5/h; max 5 owned teams (admin exempt) checked in the create's serializable transaction; transfer checks the receiver's cap | `http.teamCreate.test.ts`; matrix on real Postgres (parallel creates at 4 teams: one 201, one 409) |
| 4.5.3 | One `/dashboard`: My teams cards (role badge, next match), My stats (`MyStats`, extracted from the old player page), empty state; `/coach` and `/player` redirect | browser check |
| 4.5.4 | Role badge in team headers; coach-player "My Stats" on the team dashboard; role changes refresh `my-role` | browser check |
| 4.5.5 | One onboarding page, leading with create or join per the sign-up answer | browser check |
| 4.5.6 | `lib/viewMode.ts` and its test removed; `lib/homeTeams.ts` (+ test, which also checks the frontend copy hasn't drifted) | `homeTeams.test.ts` |

**Browser check** (local Docker DB, 360x800 and 1280), four accounts: coach only (tools, Track); player only (no
tools, own stats only, Watch; creates a team and is its Head Coach there); assistant coach who also plays on the same
team (full view plus My Stats with only their record); Wolves coach who joined the Falcons with the player code (tools
on Wolves; Player, Watch, own stats on Falcons). A stale `vv_view_mode` is removed; `/coach` and `/player` redirect.
Fixed along the way: the roster row, owner card and My stats grids overflowed 360px.

**Reviews:**
- `/code-review high`: 8 findings, all fixed (next match per team, not a global 5; lighter data for the home page and
  the own-row lookup; create links open the form; sign-up copy and contrast; a simpler ternary; the drift check).
- Independent Opus review: 1 medium (the same next-match cap, already fixed) and 6 low, all fixed (home-page error
  state; cards refresh after create/delete/transfer; 360px padding; `runSerializable` retries one serialization
  conflict; README; sign-up copy).
- `/security-review`: no findings.

**G1 pending:** the `User.signupIntent` comment in `schema.prisma` still says it gates team creation; the comment-only
edit waits for Karlos's OK.

**Verified:** backend `tsc` clean, 51 unit test files (the test-file count went down by one when `viewMode.test.ts`
was deleted with its module, and back up with `homeTeams.test.ts` and the new tests), build OK; frontend `tsc`, lint
and build clean; integration 2/2 (matrix 72 routes plus the team-creation checks). `/login`'s main chunk shrank from
224.3 kB to 220.7 kB.

### Production deploy: v9.9.0 (2026-09-29)

Karlos approved the release, the deploy and the G1 comment edit on 29 Sept.

1. The `schema.prisma` `signupIntent` comment was updated (comment only; `prisma validate` OK; no migration). `develop`
   (v9.8.0 deploy docs) was merged into the Phase 4.5 branch twice, resolving CHANGELOG and AUDIT-LOG conflicts. The
   full local suite passed on it (51 unit test files, integration 2/2 with 72 routes, `npm audit` clean) and PR #34's CI
   passed; merged. Release PR #36 (CI 6/6) merged to `main`; tag `v9.9.0` on `c562d6d`.
2. Before deploying: working tree clean, `main` = `origin/main` = the tag, no code difference from the tested branch,
   no new migration.
3. The first `deploy.ps1` run failed before publishing: the Netlify CLI answered "Project not found" for the prod site
   id. The CLI was still signed in as himextradingltd, `netlify api getSite` returned volleyvision-app for that id, and
   `.netlify/state.json` was unchanged since July, so it was a transient API error. The retry published; the smoke check
   passed (health and db ok, CSP header, unknown team 404).

**Live checks:**
- The production bundle references the new `DashboardPage` and `OnboardingPage` chunks and no longer the removed
  `CoachDashboardPage` or `PlayerPortalPage`; the dashboard chunk contains "My teams", the empty state and the error
  state; `/coach` still loads (it redirects to `/dashboard` in the app).
- The v9.9.0 API changes (team creation limits, transfer cap, the retry, per-team upcoming matches) all sit behind
  sign-in, so they weren't probed anonymously; the same build and publish path was proven live for v9.8.0 an hour earlier.
- Sentry: no issues in the two hours around the deploy.

### Phase 5 of the rebuild roadmap: the Android app (branch `rebuild/p5-android-shell`, 2026-09-29)

Why: the roadmap's native shell, so coaches can track from a phone app. Karlos has only an iPhone, so he chose
"Android first": Android is finished and checked on the emulator; iOS is a later phase (Apple Developer account and a
cloud Mac build). Released as v9.10.0 and deployed the same day (below). No migration.

| Item | Change | Test (fails before) |
|---|---|---|
| 5.1 | `lib/native.ts` (`isNative`, Back handling); `.env.native-local` / `.env.native-prod`; `X-Client: android/<version>` header, logged as the Sentry `client` tag | browser + emulator check |
| 5.2 (G2) | CORS allowlist: `CLIENT_URL` plus the exact origins in `CORS_EXTRA_ORIGINS` (`lib/corsOrigins.ts`) | `corsOrigins.test.ts`, `http.cors.test.ts` |
| 5.3 (G3) | Capacitor 8 (core/android/cli 8.5.2, app 8.1.1), installed by Karlos | `npm audit` (prod clean) |
| 5.4 | `capacitor.config.ts` and the committed `android/` project; cleartext only in the local build | `check-android-prod.mjs` |
| 5.5 | Native meta CSP from `_headers`; Back steps through history, closes menus, exits from the first screen; safe areas; links open the browser; `copyText` fallback | emulator check |
| 5.6 | Icon and splash (navy) from `frontend/assets/` | emulator check |
| 5.7 | CI `android` job: wrapper validation, the prod-config check and its test, prod sync, debug APK | `check-android-prod.test.mjs` (9 cases, proven to fail on a broken check) |
| 5.9 | Release signing reads a gitignored `keystore.properties`; `preReleaseBuild` runs the prod-config check | release build refused after the local sync |

**Emulator check** (API 34 image, driven through the WebView DevTools socket because the PC's graphics driver can't
draw the emulator screen): sign-in through the form (CORS from https://localhost works), home, team dashboard and
zones, tracking Kill / Ace / zone-4 pass then Undo, landscape, 401 back to sign-in, player view (own row only), sign
out, airplane mode then recovery, links open the browser, the photo picker opens. Two bugs found and fixed: Back
closed the app from every screen, and copying failed in the app.

**Reviews:**
- Independent Opus review: 0 high or medium, 8 low, all fixed.
- `/code-review high`: 8 findings, all fixed (Back closes an open menu first; `initNative` failures reach Sentry; copy
  keeps focus and says what to do on failure; one version source in `build.gradle`; the prod-config check has its own
  test in CI; README "Building the Android app").
- `/security-review`: no findings.

**Released:** PR #38 (CI 4/4) merged to `develop`; release PR to `main`; tag `v9.10.0`. Karlos set
`CORS_EXTRA_ORIGINS=https://localhost` in Netlify's production context (confirmed).

**Signed build:** Karlos created the upload keystore (the password was generated on his PC by a script, written into
the gitignored `keystore.properties` and never shown in chat). After `npm run android:prod`, `gradlew assembleRelease
bundleRelease` passed the prod-config check; `apksigner` and `jarsigner` verified both files against his certificate.

### Production deploy: v9.10.0 (2026-09-29)

Netlify credits ran out earlier on 29 Sept, so v9.10.0 was released and tagged (`a0052c0`, PR #40) without deploying.
Karlos then asked for one deploy attempt.

1. Before deploying: working tree clean, `main` = `origin/main` = the tag, `develop` and `main` have the same content,
   no new migration.
2. `deploy.ps1`: migrations up to date; the deploy went live; the smoke check passed (health and db ok, CSP header,
   unknown team 404).

**Live checks:**
- CORS: a preflight from `https://localhost` gets `Access-Control-Allow-Origin: https://localhost` and allows the
  `authorization` and `x-client` headers; one from another origin gets no allow-origin.
- The signed release APK on the emulator (VV_Light), running against production: native CSP present with the prod
  `connect-src`; `/health` returns ok with the database up; `/api/v1/auth/me` with a bogus token and `X-Client`
  returns the API's JSON 401, so the app's origin, headers and route all work.
- Not done: a signed-in session and a chat image upload. They need a production password, which Claude doesn't
  enter, and the emulator draws no screen, so Karlos can't type one there either. Sign-in itself was proven against
  the local API with the same build path. The first real sign-in happens on a tester's Android phone or on iOS later.
- The emulator image is `userdebug`, which opens WebView debugging for every app. Capacitor leaves it off for release
  builds (`webContentsDebuggingEnabled` defaults to the app's debuggable flag, which is off), so real phones don't
  expose it.
- Sentry: no issues in the two hours after the deploy.

### Phases 6.0 and 6 of the rebuild roadmap: carry-over fixes and the offline event queue (branches `rebuild/p6-0-carryover`, `rebuild/p6-offline-queue`, 2026-09-29)

Why: the independent review of v9.8.0–v9.10.0 found three carry-over gaps in player-record linking and ownership
transfer; Phase 6 is the roadmap's offline event queue, so a statistician can track with no signal. Released together
as v9.11.0. One migration: `20260929010857_event_client_key` (additive: `events.client_key`, unique
`(match_id, client_key)`, index `(match_id, recorded_at)`; creates no table).

| Item | Change | Test (fails before) |
|---|---|---|
| 6.0.1 (G2) | Only a PLAYER-role member can be linked to a player record; role read inside the transaction; picker lists players | `http.playerRecordLink.test.ts` (viewer/staff target 400) |
| 6.0.2 (G2) | `LINK_PLAYER` / `UNLINK_PLAYER` audit entries; unlink records the previous holder | same file (audit rows) |
| 6.0.3 | `scripts/audit-player-links.ts`, read-only, CHECK flag (names differ or role isn't PLAYER) | run on local DB: 3 links, 1 CHECK |
| 6.0.4 (G2) | Ownership transfer re-reads the owner inside its transaction (clear 409) | `teamOwnership.test.ts` |
| 6.1 (G1) | Migration above; applied to the local DB only | CI drift check |
| 6.2 | `lib/idempotencyKey`, `lib/clientTime` (2-min window, clamped to now), `lib/offlineOrder`, `lib/eventInput` | unit tests for each |
| 6.3 | `recordOneEvent`: one Read Committed transaction on the match row lock; key lookup (duplicate 200), player check, create; in order increments + set completion on the transaction, out of order replays | `eventRecording.test.ts`, `offlineReplay.test.ts` |
| 6.4 (G2) | `POST /events/batch`: TRACK_MATCH on the top-level matchId, items pinned, 1–20, own limiter (600/10 min) | `http.eventBatch.test.ts`, matrix (73 routes) |
| 6.5 | `SERIALIZATION_CONFLICT` code and `retryable: true` | `mapError.test.ts` |
| 6.6–6.11 | Client queue (tested pure core mirrored to the frontend with a drift check), offline cold start (G2: session ends only on a 401), provisional score, sync badge, refused-tap Retry/Discard, leave guards, two-device warning | `eventQueueCore.test.ts`, `scoreReplay.test.ts` drift checks, browser + emulator |

Deviations from the handoff:
- Recording uses a match row lock under Read Committed, not `runSerializable`: under SERIALIZABLE a device flushing a
  batch made live taps from the website or v9.10.0 apps fail with a 409 those apps show as "Couldn't save that event".
- The batch cap is 20, not 50 (a 50-item batch took 2.3 s locally; Netlify functions time out at 10 s).
- The batch limiter is 600 per 10 minutes, not 60: the app sends every live tap through the queue (debounced 0.8 s).
- Reset Set now sets manual override (a replay could otherwise undo the reset). Karlos approved.
- Deletes and undo-last of an event take the same match lock.

**Checks:** a 50-item batch 2.3 s and a 20-item batch 0.5–0.8 s on the local stack. Browser (local stack, 360 and 1280):
online sync, simulated offline, reconnect, API down and reload, refused tap, two-device banner, leave guard. Emulator
(VV_Light, local build): 30 taps and an Undo in airplane mode, app force-stopped and relaunched offline (still signed in,
roster shown, 29 queued), reconnect: event count and score match what was tapped, no duplicates; a 401 mid-flush keeps
the queue and it flushes after signing in again.

**Reviews:**
- Independent Opus design review of the server (4 medium, 7 low) and of the client (4 medium, 6 low): all fixed.
- `/code-review high`: 6 findings, all fixed.
- Phase-end independent Opus audit: 1 medium (batch limiter sized for bulk, not per-tap use) and 5 low, all fixed.
- `/security-review`: no findings.

**Verified:** backend `tsc` clean, 60 unit test files, build OK; frontend `tsc`, lint and build clean; integration 3/3
(matrix 73 routes); `npm audit --omit=dev --audit-level=high` clean in both (one moderate nodemailer advisory, below
the gate, needs a major upgrade: G3).

### Phase 7 of the rebuild roadmap: analytics A (branch `rebuild/p7-analytics-a`, 2026-09-29)

Why: the roadmap's analytics A, plus correcting rotation and momentum, which left out the opponent's points and
never reset per set. Karlos decided (29 Sept) to record the serving side so side-out and break-point are real. Released
as v9.12.0. One migration: `20260929034654_event_serving_side` (additive: enum `ServingSide`, nullable
`events.serving_side`; creates no table).

| Item | Change | Test (fails before) |
|---|---|---|
| 7.1 (G1) | Migration above; applied to the local DB only | CI drift check |
| 7.2 | Tracker Serving: Us / Them (asks at set start, follows the point winner, corrects, undo restores; set-jump taps carry none); `servingSide` accepted (optional, enum) and stored | `eventInput.test.ts`, browser + emulator |
| 7.3 | `teamEventsWithOpponent` for point-flow analytics only | `pointFlowRoutes.test.ts` (filters asserted) |
| 7.4 | Rotations scored with the opponent inversion; `pointWinPct`; side-out/break-point per rotation | `phase4.test.ts` |
| 7.5 | Momentum with the opponent inversion, grouped per set, sorted by time; ties aren't lead changes | `phase4.test.ts` |
| 7.6 | `lib/sideOut.ts` | `sideOut.test.ts` (hand-built set) |
| 7.7 | `lib/advancedMetrics.ts` ported; `receptionQuality`; sets counted per match | `advancedMetrics.test.ts` |
| 7.8 | Five read-only team-level routes behind the visibility guards | matrix 78 routes + no-player shape checks |
| 7.9 | Rotation, momentum and advanced panels, lazy-loaded | browser check |
| 7.10 | Report momentum and best rotation from an opponent-inclusive list; same shape | `matchReportZones.test.ts` |
| 7.11 | Seed: the rally winner serves the next | scripts typecheck |

**Checks:** browser (local stack, 360 and 1280): seed match m1 panels match a SQL hand count (side-out 9 of 13 = 69.2%,
break-point 14 of 18 = 77.8%); set selector; empty and coverage states; no page overflow; 44px controls; a player sees
the team panels and no individual data. Emulator (local build): six taps offline with serving on, synced: side-out
66.7% (2 of 3) and break-point 33.3% (1 of 3), equal to the hand count.

**Reviews:**
- `/code-review high`: 6 findings, all fixed (momentum grouping, team blocks per set, tokens, contrast, run cap, tooltip).
- Phase-end independent Opus audit: 2 medium (serving on set-jump taps; undo restoring serving) and 5 low, all fixed.
- `/security-review`: no findings.

**Verified:** backend `tsc` clean, 63 unit test files, build OK; frontend `tsc`, lint and build clean; integration 3/3
(matrix 78 routes).

### Production deploy: v9.11.0 and v9.12.0 (2026-09-29)

Karlos applied both migrations and asked Claude to deploy the same day. v9.11.0 was never deployed on its own.

1. **Migrations (Karlos):** `npx prisma migrate deploy` from `backend/` applied `20260929010857_event_client_key` and
   `20260929034654_event_serving_side` (both additive). No separate backup was taken first; both changes only add a
   column, an enum type and indexes.
2. **Link audit C1 (Karlos, read-only):** 1 linked record in production, 1 CHECK: Karlos's own test accounts on team
   "Tester" (record #99 linked to an account that is Head Coach there). Left for Karlos to keep or unlink.
3. **Signed Android build:** `npm run android:prod`, then `.\gradlew.bat assembleRelease bundleRelease` (JDK 21): the
   prod-config guard passed; `apksigner` verified the APK against the upload key (SHA-256 `2E:07:6D:61…8E:43:04`),
   versionName 9.12.0, versionCode 3; `jarsigner` verified the AAB.
4. **Deploy:** from a clean `main` = `v9.12.0` (`9b38a8b`), `deploy.ps1`: migrations up to date, deploy live
   (`6abb7f2153606c0adfda47fc`), smoke check passed (health and db ok, CSP header, unknown team 404). The first attempt
   failed in the build, before publishing, because a local API left running locked Prisma's engine file; it passed
   once that was stopped.

**Live checks:**
- `POST /api/v1/events/batch` without a token answers 401 (the route exists; v9.10.0 had none).
- `GET /api/v1/analytics/matches/nope/rotations` and `/teams/nope/advanced` answer the guards' JSON 404.
- The production bundle contains the offline queue (`vv_queue:`) and the tracker's "Who serves first?", "All saved"
  and "Offline —" text.
- `/health`: `{"status":"ok","db":"ok"}`. Sentry: no unresolved issues in the hour after the deploy.

### Phase 8.0 of the rebuild roadmap: carry-over fixes (branch `rebuild/p8-0-carryover`, 2026-09-30)

Why: the independent review of v9.11.0–v9.12.0 found score writers outside the match lock, an absolute manual score
that erased another device's points, stale set-closing marks after a replay, other players' account ids in roster
responses, a silently stuck offline queue, and gaps in `backup.ps1`. Released as v9.13.0 on its own (Karlos, 30 Sept);
Phase 8 (analytics B) follows as v9.14.0. No migration.

**Lock design (recorded):** every writer of a match's score state runs in a Read Committed transaction holding the match
row lock (`withMatchLock` → `lockMatch`, `SELECT … FOR UPDATE`), not `runSerializable`: under SERIALIZABLE a flushing
device made live taps from older clients fail with a 409 they show as an error (Phase 6.3). Writers on one match wait
their turn instead.

| Item | Change | Test (fails before) |
|---|---|---|
| 8.0.1 | `updateScore`, `resetSetScore`, `resetMatch`, both undo branches, delete-by-id and `PATCH /matches/:id` status/setScores take the lock and read through it; `removeEventLocked` re-reads the event under it. `PATCH /matches/:id/score` takes optional `homeDelta`/`awayDelta` (whole numbers, ±100) applied to the locked score; the tracker sends the delta and the absolute (an older server uses the absolute, a current one the delta) | `scoreWriterLocks.test.ts`; integration `scoreConcurrency.test.ts` (20 rounds, 20-tap batch vs +1) |
| 8.0.2 | Reset confirms say taps from other devices are added as they arrive for the rest of the match; the override is never cleared (a replay can't reproduce manual resets) | browser |
| 8.0.3 | `replayTimeline` returns `closers`; `recalculateMatchState` sets and clears `completedSet` on events and adjustments to match; both `scoreReplay` copies | `scoreReplay.test.ts`; integration `setMarks.test.ts` |
| 8.0.4 (G2) | Non-staff get `userId: null` on other players' rows from `GET /matches/:id`, `/teams/:id`, `/players/by-team/:teamId`, `/players/:id` (`maskOtherUserIds`); the offline match cache keeps the tracker's fields only, trimmed on write, on read and once at startup | `rosterUserIdMask.test.ts`, `matchCacheShape.test.ts` |
| 8.0.5 | 5 server errors in a row: the badge says so and Sentry gets one message per match per session (id, count, status) | browser (API stopped: 6 taps, badge, recovery) |
| 8.0.6 (G7) | `backup.ps1`: URL off docker's command line, no URL in parse errors, `-OutDir` resolved and refused inside the repo, Storage not covered; `.gitignore` `vv-backup-*.sql`; `deploy.ps1` prod needs today's backup unless `-NoBackup` | run on the local DB only |
| 8.0.7 | Match time: investigated (web forms send wall-clock time, the UTC function stores it as UTC, the UI shows local time); fix waits on Karlos's SQL, moved to v9.14.0 | — |

**Reviews:**
- `/code-review high`: 6 findings; 4 fixed (in-repo check against .NET's directory; pre-completion response; one lock
  helper; mark-rewrite unit test), 2 skipped (permission lookup cost on the live poll; badge width checked in the browser
  instead).
- Phase-end independent Opus audit: PASS with 1 medium (a v9.13 tracker against a v9.12 server scored nothing) and 3 low
  (old cache copies not rewritten; the in-repo check; a `docker inspect` comment), all fixed.
- `/security-review`: no findings.

**Verified:** backend `tsc` clean, 66 unit test files, build OK; frontend `tsc`, lint and build clean; integration 5/5
(matrix 78 routes); `npm audit --omit=dev --audit-level=high` clean (nodemailer moderate only, G3).
