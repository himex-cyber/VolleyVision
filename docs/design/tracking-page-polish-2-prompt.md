# Prompt: Tracking page polish — LIVE badge, button order, set results, events feed

Paste this into Claude Code from the `VolleyVision` repo root. Six changes across `frontend/src/pages/TrackingPage.tsx`, `frontend/src/components/scoreboard/LiveScoreboard.tsx`, and `frontend/src/types/index.ts`.

## 1. Make the "● LIVE" badge non-interactive

`MatchPageHeader.tsx` already owns match status changes via its own dropdown (Scheduled/In Progress/Completed/Cancelled) rendered above the scoreboard on this same page, so the scoreboard's status indicator is redundant as a control — it should just display status, not change it.

In `LiveScoreboard.tsx`, the `● LIVE` element is currently a `<button onClick={onToggleStatus}>`, rendered only when `onToggleStatus` is passed. Change it to an always-rendered, non-interactive `<span>`/`<div>` driven purely by the (already required) `status` prop — no click handler, no conditional rendering tied to a handler. Remove the `onToggleStatus` prop from `LiveScoreboardProps` entirely, and in `TrackingPage.tsx` remove `handleStatusToggle` and the prop being passed. Once that's gone, check whether `updateMatch`/`useUpdateMatch` is still used anywhere else in `TrackingPage.tsx` — if `handleStatusToggle` was its only caller, remove that import/hook call too rather than leaving it dead.

## 2. Reorder the bottom control row

Currently left to right: Undo Event → Reset Set → Reset Match. Change to: **Undo Event → Reset Match → Reset Set**. This is just swapping the JSX order of the `onResetSet` and `onResetMatch` blocks in `LiveScoreboard.tsx`'s controls row — no other logic changes.

## 3. Remove the "Set Results" section from the scoreboard

It duplicates what `MatchDashboardPage.tsx` (Match Stats tab) already shows — identical per-set score breakdown, one tab away. Remove the whole `{/* ── Set results ── */}` block at the bottom of `LiveScoreboard.tsx`. `setScores`/`hasSets` will become unused there — either drop the `setScores` prop from `LiveScoreboardProps` and its usage in `TrackingPage.tsx`, or leave the prop declared but unused if you want to preserve it for the component's documented future reuse as a read-only match view (its docstring already anticipates that). Don't leave dead local variables either way.

## 4. Recent Events header links to the Events tab

In `TrackingPage.tsx`, the "Recent Events" card header (currently a plain `<div>`) should become a link to `/matches/${matchId}/events` (the existing Events tab route — see `MatchSubNav.tsx`), using the `Link` component already imported in this file. Give it a hover affordance (color change, maybe a small chevron) so it visually reads as clickable, consistent with other links in the app.

## 5. Bigger recent-event rows with a player avatar

Each row in the Recent Events feed (`TrackingPage.tsx`, the `.divide-y` block) needs more vertical room and a player avatar on the right. Reuse the existing avatar convention from `StatsOverview.tsx` — a circular chip (`rounded-full bg-navy-100 text-navy-700`, centered jersey number) rather than inventing a new style; scale it down from that table's `w-12 h-12` to something that fits a compact list row (try `w-9 h-9` or `w-10 h-10`). Only render it when `event.player` exists, mirroring the existing `{event.player && ...}` condition already used for the jersey/last-name text in that row. Increase row padding (currently `px-4 py-2.5`) enough to comfortably fit it without the row feeling cramped.

## 6. Show rotation on each event row, alongside zone

The frontend `Event` type (`frontend/src/types/index.ts`, ~line 551) is missing `rotationNumber` even though the backend already records and returns it (`recordEvent` in `backend/src/controllers/events.ts` stores it, and `getEventsByMatch` returns full rows) — add `rotationNumber?: number | null;` to the interface. Then in the Recent Events row, add a rotation badge next to the existing zone badge, same visual treatment (`badge bg-grey-50 text-navy-700 border border-grey-200`), e.g. `R{event.rotationNumber}`, shown only when `event.rotationNumber != null` — mirror the existing `Z{event.courtZone}` badge exactly.

## After implementing

Sanity-check the tracking screen still reads cleanly at typical tablet width with the taller event rows and the extra rotation badge — confirm nothing wraps awkwardly. Confirm the LIVE badge still visually reflects `IN_PROGRESS`/`COMPLETED` correctly even though it's no longer clickable, and that changing status via `MatchPageHeader`'s dropdown still updates it (it's driven by the same `status` prop, just no longer double-controlled).
