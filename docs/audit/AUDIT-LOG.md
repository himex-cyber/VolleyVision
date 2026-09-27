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

Verified at the end of Phase 1B: backend `tsc` is clean, all 15 test files pass (2 new), and the backend builds; frontend `tsc` is clean and `vite build` works.
