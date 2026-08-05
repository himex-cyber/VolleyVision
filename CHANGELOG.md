# Changelog

All notable changes to VolleyVision, reconstructed from the repository's commit and tag history. Versions are listed newest first, in chronological order of release. Untagged commits are listed under the tagged release they shipped with.

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
