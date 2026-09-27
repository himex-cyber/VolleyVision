# Prompt: Live scoreboard — post-testing adjustments

Paste this into Claude Code from the `VolleyVision` repo root. This is a follow-up to the "rebuild the live scoreboard as a reusable component" work (`frontend/src/components/scoreboard/LiveScoreboard.tsx`, wired up in `frontend/src/pages/TrackingPage.tsx`). Five changes based on hands-on testing — the manual End Set flow turned out to complicate the live-tracking flow, so it's coming back out.

## 1. Remove manual "End Set" from the frontend; comment out the backend for later

Frontend: stop passing `onEndSet` to `<LiveScoreboard>` in `TrackingPage.tsx` — remove the `handleEndSet` function, the `endSet` mutation (`useEndSet`), and the prop. `LiveScoreboard.tsx` already renders the "END SET →" button conditionally on `onEndSet` being passed (see the `{onEndSet && (...)}` block and the outer `{(onUndoSet || onEndSet || onResetSet || onResetMatch) && (...)}` guard), so not passing it removes the button with no other changes needed there — the `onEndSet` prop can stay defined on `LiveScoreboardProps` since it's designed to be optional per-surface.

Backend: comment out (don't delete) the manual-override entry point — the `POST /:id/score/end-set` route in `backend/src/routes/matches.ts` and the `endSet` controller it points to. Leave a comment explaining it's disabled because it complicated the live-tracking flow in testing, kept for possible future use. Important: if `checkSetCompletion`'s automatic-completion logic was refactored into a shared helper that both the automatic path and this manual endpoint called, don't touch that shared helper — only comment out the manual endpoint's route registration and controller entry point. Automatic set completion at 25/15 win-by-2 must keep working exactly as before.

## 2. Remove "Undo Set" completely; replace it with the existing "Undo Event" button in that slot

Unlike End Set, there's no ask to preserve this one — remove it fully, frontend and backend (route, controller, hook, API client method). If you'd rather comment out the backend route the same way as End Set for consistency/reversibility, that's fine too, but the frontend must have zero trace of "Undo Set."

`Undo Event` (currently the `↩ Undo Event` button in the top control row next to the `● LIVE` status toggle, wired via `onUndoEvent`/`handleUndo` — see `TrackingPage.tsx` and the `onUndoEvent && (...)` block in `LiveScoreboard.tsx`) moves down into the set-operations row at the bottom, taking the spot "Undo Set" used to occupy. The top row should end up with just the set-jump (1–5) selector and the `● LIVE` status toggle.

## 3. Reset Set in the middle

The bottom row, after items 1 and 2, should read left to right: **Undo Event → Reset Set → Reset Match**. (Reset Set already sits between where Undo Set and Reset Match were, so this likely falls out naturally once Undo Event takes Undo Set's old slot — just confirm the final order matches.)

## 4. Pull the per-side "−" buttons into that same bottom row

Right now each `TeamPanel` in `LiveScoreboard.tsx` renders its own "−" button internally (~lines 129–148), tucked under that side's score. Move both out of `TeamPanel` and into the same horizontal row as Undo Event / Reset Set / Reset Match, so the whole thing reads as one row: **home − → Undo Event → Reset Set → Reset Match → away −**. They should still sit directly under the scorebug (same vertical position as before), just consolidated into the one shared row instead of living inside each team's own column. Keep the existing behavior (disabled at 0, `onScore(side, -1)`, `stopPropagation` so it doesn't also trigger the panel's add-point click) — just relocate the JSX and remove the now-empty wrapper it used to sit in.

## 5. Drop two bits of explanatory copy

- The "Tap score to add · − to correct" caption that sits next to each "−" button — this goes away as part of item 4's restructure; don't recreate it in the new row.
- The "Set Results" empty-state sentence ("No completed sets yet — press **END SET** to record one.") — it references a button that no longer exists after item 1, so it has to change regardless. My read of "remove the set results commentary" is: drop this explanatory sentence (and don't replace it with new copy referencing Reset/other buttons), not the "Set Results" label or the actual set-score chips themselves — those stay. If there are no completed sets yet, it's fine for that area to just render nothing, or a much shorter neutral placeholder with no button reference. Flag me if you meant the whole section instead.

## After implementing

Re-check the bottom row at typical tablet width — five controls in one row (two − buttons plus three set-ops buttons) is tighter than before, so confirm nothing wraps awkwardly or gets too cramped to tap accurately. Confirm automatic set completion (25/15 win-by-2) still fires correctly with End Set gone, and that Undo Event in its new position still correctly undoes the last recorded stat event (not a set).
