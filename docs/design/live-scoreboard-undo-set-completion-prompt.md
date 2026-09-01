# Prompt: Undo doesn't reverse a set-completing point correctly

Paste this into Claude Code from the `VolleyVision` repo root. Follow-up to the Undo Event / ScoreAdjustment fix in `backend/src/lib/undo.ts`.

## The gap

`reverseAdjustmentScore` in `lib/undo.ts` reverses a `ScoreAdjustment`'s delta against the match's *current* running score. If that adjustment was the point that completed a set — `checkSetCompletion` (in `lib/scoring.ts`) fired inside the same `updateScore` request, reset `homeScore`/`awayScore` to 0, banked a `setScores` entry, and incremented the winner's sets-won — then reversing against the current (already-reset) score is undoing against the wrong baseline: `0 - delta` just clamps back to `0`, and the completed set stays banked. The tap that closed the set doesn't actually get undone; it silently no-ops.

This isn't rare enough to ignore: the scoreboard's tap-to-add-a-point panels are the primary scoring method for anyone using this as a plain scorekeeper (as opposed to tapping through individual kill/dig/etc. buttons), so for that usage pattern every set-ending point goes through exactly this path.

**Same defect likely exists on the event side too.** `applyEventRemoval` (`matchState.service.ts`) only does a full timeline replay — which would naturally reconstruct correct pre-completion state — when the match is *not* under `manualScoreOverride`. Once a match has had a Reset Match (or, if ever re-enabled, an End Set), `manualScoreOverride` is `true` and event undo falls back to `reverseEventScore`, a direct reversal against current state with the same "ignorant of the reset" shape as `reverseAdjustmentScore`. Check whether `reverseEventScore` has the identical bug on an overridden match where the event being undone was the one that completed a set, and fix both in this pass if so — don't leave one fixed and the other not.

## The fix

Don't try to infer after the fact whether a given adjustment/event completed a set (heuristics based on "did the reversal want to go negative" are fragile — a score can legitimately already be 0). Instead, record it at the moment it happens, since `checkSetCompletion` already runs synchronously in the same request right after the score-affecting write:

- Add a field to `ScoreAdjustment` (e.g. `completedSet: Boolean @default(false)`, small migration) set to `true` at creation time in `updateScore` (`matches.ts`) if `checkSetCompletion` actually completed a set as a result of that adjustment. Do the same for `Event` if the event-side bug above is confirmed.
- In the undo path: when the target is an adjustment/event whose `completedSet` flag is `true`, don't just reverse the score delta — also reverse the set completion. Use the popped `setScores` entry (its `home`/`away` values are the exact pre-completion-but-post-point score) as the source of truth: pop that entry off `setScores`, decrement the winning side's `homeSetsWon`/`awaySetsWon` by 1, restore `homeScore`/`awayScore` from that entry (minus this adjustment/event's own delta, to land on the score as it was *before* the final point — not after it), and revert `status` from `COMPLETED` back to `IN_PROGRESS` if this same completion was the one that finished the match.
- If `completedSet` is `false`, behavior is unchanged — plain delta/event reversal as it works today.

This is conceptually close to what the old `undoLastSet` helper did before it was deleted as dead code in the previous iteration (pop last set, decrement sets won, restore prior score) — it's recoverable from git history if the shape is useful as a reference, though this version is narrower: it only triggers automatically when the thing being undone specifically caused the completion, not as a standalone manual button.

## Tests

Add cases to `undo.test.ts` (and the event-side equivalent if that path needs the same fix): a tap that completes a set, followed by undo, restores the pre-point score and un-banks the set; the match's `status` reverts correctly if that set also finished the match; a tap that does *not* complete a set still behaves exactly as the current (already-shipped) fix does.
