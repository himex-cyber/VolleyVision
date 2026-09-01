# Prompt: Two scoreboard bugs from hands-on testing

Paste this into Claude Code from the `VolleyVision` repo root. Two fixes, both root-caused already — implement against these specifics rather than re-diagnosing from scratch.

## 1. "Undo Event" ignores manual score adjustments (the −/+ score taps)

**Root cause:** tapping the score (+1) or the "−" button doesn't create an `Event` row — it goes through `updateScore` in `backend/src/controllers/matches.ts`, which computes a delta and writes a `ScoreAdjustment` row (`prisma.scoreAdjustment.create`), separate from the `Event` table entirely. Meanwhile "Undo Event" (`↩ Undo Event` in `LiveScoreboard.tsx`, wired to `deleteLastEvent` in `backend/src/controllers/events.ts` via `DELETE /events/undo/:matchId`) only ever queries the `Event` table. So if the most recent action was a manual score tap, Undo Event has no idea it happened — it reaches past it to the last *real* stat event (a kill, dig, etc.) and reverses that instead. That's the "clicking undo minuses the score again" bug: it's silently undoing the wrong, older action.

**Fix:** `deleteLastEvent` needs to compare the most recent `Event` (by `recordedAt`) against the most recent `ScoreAdjustment` (by `createdAt`) for the match, and undo whichever actually happened last:

- If the latest action is an `Event`: keep the current behavior (`prisma.event.delete` + `applyEventRemoval`, from `matchState.service.ts`).
- If the latest action is a `ScoreAdjustment`: reverse it — apply the *inverse* of its `homeDelta`/`awayDelta` to the match's running score (a `-1` adjustment undoes to `+1`, not another `-1`), then delete that `ScoreAdjustment` row. This does **not** go through `applyEventRemoval` (that's event-specific) — it's a direct, symmetrical reversal of the adjustment that created it.
- If there's neither an `Event` nor a `ScoreAdjustment` for the match, keep the existing 404 ("No events to undo.") behavior.

Also check `canUndoEvent` on the frontend (`TrackingPage.tsx`, currently `canUndoEvent={!!events?.length}`, passed into `LiveScoreboard`'s `↩ Undo Event` button). That only accounts for `Event` rows, so the button will render disabled on a match that has manual score adjustments but zero recorded stat events yet, even though there'd be something to undo. Fix this so the button's enabled state reflects "is there anything to undo" (events *or* adjustments), not just events. Simplest correct approach: have the frontend not try to precompute this at all and just rely on the existing catch path (`showFlash('Nothing to undo', false)` on a 404) — but if you keep a `canUndoEvent`-style prop for UX (disabled vs. enabled-but-errors), it needs the adjustment count too, not just event count.

Write a test alongside the existing coverage for this endpoint (`backend/src/lib/` has `phase4.test.ts` and `scoreReplay.test.ts` as reference style) covering: undo after a score tap reverses correctly (in direction), undo after a stat event still works as before, and undo when the most recent action is ambiguous by timestamp is deterministic.

## 2. Reset Match doesn't clear or record anything about recorded stat events

**Root cause:** `resetMatch` in `backend/src/controllers/matches.ts` deletes every `ScoreAdjustment` for the match but never touches the `Event` table — every kill/dig/ace recorded before the reset survives untouched, and nothing records that a reset happened at all.

**Decision made:** keep the recorded stat events — this is an analytics app and per-player stat history (who dug/killed what) shouldn't silently disappear just because the score/set state got reset. Don't delete `Event` rows in `resetMatch`.

**Fix:** add an audit log entry when a match is reset, using the existing `logAudit()` pattern already used elsewhere in this exact file for `CREATE_MATCH`/`UPDATE_MATCH`/`DELETE_MATCH` (see those call sites in `matches.ts` for the exact call shape — `logAudit(userId, ACTION, 'match', matchId, meta?)`, `userId` from `req.user!.userId`). Log it as something like `'RESET_MATCH'`, with `meta` capturing what was cleared (e.g. previous `homeScore`/`awayScore`/`homeSetsWon`/`awaySetsWon`/`setScores` before the reset, and how many `ScoreAdjustment` rows were deleted) so there's a real record of what the reset actually wiped, given the match's events are the only thing left that predates it.

While you're in there: the client-side confirm dialog for Reset Match (`handleResetMatch` in `TrackingPage.tsx`) currently says "Every set score and set won will be cleared" — that's still accurate now that events are explicitly kept, but consider whether it should say so explicitly (e.g. "...cleared. Recorded stats/events are kept.") so a coach isn't left guessing whether their event history just vanished too.

## After implementing

For #1: test on a match where the sequence is stat event → score tap (−) → Undo Event, and confirm it reverses the score tap, not the stat event. Also test stat event → Undo Event with no adjustments in between, to confirm the original behavior didn't regress.

For #2: reset a match with a few recorded kills/digs, confirm the events are still visible in the match's event log afterward, and confirm an audit log row was written for the reset.
