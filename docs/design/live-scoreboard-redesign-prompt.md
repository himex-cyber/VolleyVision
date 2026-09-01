# Prompt: Rebuild the live scoreboard using the new design as a reference

Paste this into Claude Code from the `VolleyVision` repo root.

## Reference design

A Claude-generated mockup is at `docs/design/live-scoreboard-design.dc.html` — open and read it first. It's a static HTML/CSS demo with fake local state, not real code, but it establishes the visual direction: big tap-to-score digits, gold accent on the home (your team) side, navy accent on the away side, zero-padded score numbers, a center "SET" block with sets-won dot indicators, and a set-results history strip.

**Use it as a reference, not a template — adapt it to this app's actual data model, existing controls, and component conventions instead of porting the markup 1:1.** Where the mockup's interaction model conflicts with how this app already works (see below), the app's existing behavior wins unless a section here says otherwise.

## Scope: replace the scoreboard card in TrackingPage, built as a reusable component

Today the live scoreboard is inline JSX inside `frontend/src/pages/TrackingPage.tsx` (the "Live Scoreboard + controls" card, roughly lines 172–297). Extract it into its own component — e.g. `frontend/src/components/scoreboard/LiveScoreboard.tsx` — and have `TrackingPage` render it. This is deliberate: the plan is to eventually make this the default scoreboard used elsewhere in the app too (e.g. a read-only match view), so design its props around a clean, reusable interface now rather than tying it tightly to `TrackingPage`'s internals. It doesn't need to support a read-only mode yet — just don't paint yourself into a corner.

Keep it visually consistent with the mockup: zero-padded score digits (`String(n).padStart(2, '0')`), tap-anywhere-on-the-score to increment, gold left-accent on home / navy right-accent on away, the center set-number block, and per-team "sets won" dot indicators (3 dots, filled up to `homeSetsWon`/`awaySetsWon` — matches match with best-of-5 already assumed elsewhere, e.g. `backend/src/lib/scoring.ts`).

## Don't lose existing controls — reconcile, don't replace

`TrackingPage` currently has controls the mockup doesn't show at all. Keep all of them; just fit them into the new layout sensibly:

- **Match status toggle** (`● LIVE` / `COMPLETED`, via `handleStatusToggle` / `useUpdateMatch`) — starts/finishes the match. Not in the mockup. Keep it.
- **Undo last event** (the existing `↩ Undo` button, via `useUndoEvent`) — undoes the last *recorded stat event* (kill, dig, etc.), not a set. The mockup has an "Undo set" button that means something different (see below). Keep both, and label them distinctly enough that they're never confused — e.g. "Undo Event" vs "Undo Set".
- **Set selector (1–5 tabs)** — lets the coach jump directly to any set to view/record against, not just step sequentially. The mockup only has Prev/Next set. Sequential-only navigation is a regression (can't jump straight to Set 2 while Set 4 is live to fix a mis-tap). Keep direct set-jump capability; you can add Prev/Next alongside it if it fits the layout, but don't remove the ability to jump directly to a specific set.

## New backend behavior required

Two things the mockup implies don't exist in this backend yet. Read `backend/src/lib/scoring.ts`, `backend/src/lib/matchIntegrity.ts`, `backend/src/lib/scoreValidation.ts`, and `backend/src/lib/scoreReplay.ts` first — this app validates score-state integrity carefully (there's a whole `scoreReplay.test.ts`), so new mutations need to preserve those invariants and get equivalent test coverage, not bolt on ad hoc logic.

**1. Manual "End Set" override.** `checkSetCompletion()` in `scoring.ts` already auto-completes a set the moment a team reaches 25 (or 15 in set 5) with a 2-point lead — resets scores to 0, increments `homeSetsWon`/`awaySetsWon`, appends to `setScores`, marks the match `COMPLETED` if a side reaches 3 sets. Add a manual override for edge cases (forfeit, rain delay, correcting a stuck state) that runs the same completion effects *without* requiring the threshold to be met, based on whichever side currently has more points. Refactor `checkSetCompletion`'s completion logic into a shared helper both the automatic path and this new manual endpoint call — don't duplicate it. Reject the action (no-op, surface an error) if the scores are currently tied, since there's no winner to declare. Add a route (e.g. `POST /matches/:id/score/end-set`) following the existing pattern in `backend/src/routes/matches.ts`.

**2. "Undo Set."** Pop the most recent entry off `setScores`, decrement whichever side's `homeSetsWon`/`awaySetsWon` that set had incremented, restore `homeScore`/`awayScore` to that entry's values so the match resumes mid-set, and un-complete the match (`status` back to `IN_PROGRESS`) if it had been marked `COMPLETED` by that set. No-op if `setScores` is empty. Add a route (e.g. `POST /matches/:id/score/undo-set`), consistent with the existing `POST /:id/score/reset` (`resetSetScore`) pattern nearby.

Write tests for both alongside the existing ones in `backend/src/lib/` (look at `phase4.test.ts` and `scoreReplay.test.ts` for the existing style/coverage expectations).

**3. "Reset match"** (the mockup's destructive red button) is broader than the existing `resetSetScore` (which only zeroes the *current* set). It needs to zero `homeScore`/`awayScore`/`homeSetsWon`/`awaySetsWon`, clear `setScores` entirely, and revert `status` to `IN_PROGRESS` if completed. Given how destructive this is, gate it behind a `confirm()` dialog client-side, matching the existing pattern in `TrackingPage.handleResetSetScore`.

## Explicitly out of scope

Drop the mockup's inline click-to-rename team name — display team names read-only from match data, same as `TrackingPage` does today. No new persistence needed for that part.

## After implementing

Sanity-check the new scoreboard component at typical tablet width (this screen is used courtside, one-handed), confirm the match-status toggle and event-undo still work exactly as before, and confirm End Set / Undo Set / Reset Match all update `setScores`/`homeSetsWon`/`awaySetsWon` correctly against a live match with a few sets already recorded — not just a fresh 0–0 one.
