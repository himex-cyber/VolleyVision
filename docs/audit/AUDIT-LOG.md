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

