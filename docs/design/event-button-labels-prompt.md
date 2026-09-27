# Prompt: Event button label & sizing updates

Paste this into Claude Code from the `VolleyVision` repo root. Changes are in `frontend/src/types/index.ts` (`EVENT_META`), `frontend/src/index.css` (`.btn-event*`), and `frontend/src/pages/TrackingPage.tsx` (event button rendering).

**These are label/display changes only — no `EventType` values, no backend fields, no analytics logic change**, except item 6 below which needs a small structural change to the button (not the data) to keep two values selectable from what reads as one button.

## 1. Larger button text

In `frontend/src/index.css`, `.btn-event` currently sets `text-sm leading-tight` for all three variants (`-positive`/`-negative`/`-neutral`). Increase the label text size so it fills the button better (e.g. `text-base` or a touch larger) — labels are also getting longer in this same pass (see below), so check padding/`min-height` (currently `76px`) still comfortably fits two-word labels like "Setting Error" or "Service Error" without cramping or overflowing. Adjust padding/min-height together with the font bump if needed, don't just bump font-size in isolation.

## 2. Spell out remaining abbreviations

In `EVENT_META`:
- `SERVICE_ERROR`: `'Svc Error'` → `'Service Error'`
- `SETTING_ERROR`: `'Set Error'` → `'Setting Error'` (also avoids reading like it refers to a match Set, which this screen already uses "Set" for elsewhere)

(`ATTACK_ERROR`, `BLOCK_ASSIST`, `BLOCK_ERROR` were already spelled out in an earlier pass — leave those as-is.)

## 3–5. Renamed labels (display only)

- `PASS_0`: `'Pass 0'` → `'Shank Pass'`
- `PASS_3`: `'Pass 3'` → `'Dime Pass'`
- `SOLO_BLOCK`: `'Solo Block'` → `'Roof'`

## 6. Pass 1 / Pass 2 — one button, two tap zones

`PASS_1` and `PASS_2` are two distinct values on the 0–3 passing-rating scale your passing analytics is built on (`ZonePass` in `backend/src/lib/heatmap.ts` counts `pass3/pass2/pass1/pass0` separately) — they can't become a single `EventType` without losing that resolution. Decision: keep both values distinct, but present them as one visual button split into two tap zones, both labeled "Pass."

Worth knowing going in: `PASS_1` and `PASS_2` already share the same `outcome: 'neutral'` in `EVENT_META`, so they already render in identical color today — the number in the label is currently the *only* way to tell them apart. If the primary label on both halves just says "Pass," keep a small, unobtrusive numeric tag on each half (e.g. a small "2" / "1" in a corner) so it's still reliably distinguishable rather than relying purely on which half a coach remembers to tap.

Implementation: the Pass category currently renders via the generic loop in `TrackingPage.tsx` that maps `cat.events` 1:1 to plain buttons (`PASS_3`, `PASS_2`, `PASS_1`, `PASS_0`, one button each, grid columns = `cat.events.length`). That generic model doesn't support a compound button, so special-case the Pass row: three visual slots — Dime Pass (`PASS_3`) · a split Pass button (left/top half = `PASS_2`, right/bottom half = `PASS_1`, in that order, matching the existing descending-quality ordering) · Shank Pass (`PASS_0`) — sized to occupy the same overall footprint as the current 4-button row (adjust `gridTemplateColumns` for this category to 3 slots, with the middle slot internally split via a nested flex/grid). Each half of the split button should still independently call `handleRecord('PASS_2')` / `handleRecord('PASS_1')` and get its own `justRecorded` pulse feedback, exactly like a normal event button does today — only the visual presentation is compound, not the recording logic.

## After implementing

Check the Pass row and the rest of the event-button grid at typical tablet width: confirm the split Pass button's two zones are comfortably tappable (not so cramped a coach reliably mis-taps between grade 2 and grade 1), and confirm the longer full-word labels elsewhere (Service Error, Setting Error, Shank Pass, Dime Pass) fit cleanly at the larger text size from item 1.
