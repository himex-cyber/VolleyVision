# Prompt: Tracking screen — label accuracy, court diagram, button polish

Paste this into Claude Code from the `VolleyVision` repo root. Three independent fixes to the live tracker (`frontend/src/pages/TrackingPage.tsx`, `frontend/src/components/tracking/CourtZoneSelector.tsx`, `frontend/src/types/index.ts`, `frontend/src/index.css`).

## 1. Spell out abbreviated event labels

In `frontend/src/types/index.ts`, `EVENT_META` currently abbreviates a few labels to save space. Spell them out in full:

- `ATTACK_ERROR`: `'Att. Error'` → `'Attack Error'`
- `BLOCK_ASSIST`: `'Blk Assist'` → `'Block Assist'`
- `BLOCK_ERROR`: `'Blk Error'` → `'Block Error'`

(`SOLO_BLOCK` is already spelled out as `'Solo Block'` — leave it.)

After the change, check the event button grid in `TrackingPage.tsx` (`.btn-event`, `min-height: 76px`, `text-sm leading-tight`, flex-col centered). The Attack category renders 5 buttons across one row via `repeat(cat.events.length, 1fr)`, so "Attack Error" and "Block Error"/"Block Assist" need to wrap or scale cleanly at typical tablet widths without breaking row height consistency with their neighbors. Adjust font-size/line-height/padding only as needed to keep all buttons in a row visually even — don't change the grid structure.

## 2. Move the net line to the top of the court zone diagram

In `CourtZoneSelector.tsx`, the zone grid renders two rows — `[4, 3, 2]` (front row, near the net) on top and `[5, 6, 1]` (back row) below — but the "NET" divider line is currently drawn at `top-1/2`, i.e. horizontally through the middle, between the two rows. That's misleading: the net should read as the boundary at the very top of the diagram (above the front-row zones), not a line splitting front from back row.

Move the net indicator (the gold line + "NET" label) to the top edge of the outer bordered container, above the `4 | 3 | 2` row, rather than between the two rows. The middle no longer needs a net marker — if you want a subtle divider between front/back row for readability, it should not be labeled or styled as the net (it's the attack line, if anything, and doesn't need a label).

## 3. Button polish — keep the semantic colors, refine everything else

Don't change what the button colors mean. `frontend/src/index.css` documents this deliberately: `.btn-event-positive`/`-negative`/`-neutral` use green/red/navy specifically because `docs/brand/BRAND-GUIDELINES.md` calls out the tracking screen as an intentional exception — courtside legibility over brand-color consistency — and explicitly says success/error "stay semantic, never gold." Keep that. This is a polish pass on top of it, not a re-theme.

Within that constraint:

- Tie the "just recorded" flash (currently `scale-95 brightness-150` in `TrackingPage.tsx`, triggered via the `justRecorded` state) to the brand's one true accent — gold. The base `.btn-event` class already applies `focus-visible:ring-gold-500`; extend that same gold-ring treatment to the brief post-tap pulse so the "this just happened" signal consistently reads as gold, the way active/highlight states do everywhere else in the app, rather than (or in addition to) a plain brightness jump.
- Audit border treatment across the three variants: `.btn-event-neutral` currently has a `border-navy-600`; `-positive` and `-negative` have none. Decide this intentionally — either give all three a consistent subtle border for a more cohesive, "designed" look, or confirm the current asymmetry is deliberate and leave a comment explaining why.
- Re-check spacing/padding now that labels are longer (per item 1) — buttons should feel evenly weighted, not cramped, at the `min-height: 76px` tablet target size.
- Optional/stretch, only if low-risk: a slightly more tactile pressed-state (e.g. subtle inset shadow alongside the existing `active:scale-95`) rather than relying on brightness alone for tap feedback. Skip if it adds meaningful complexity.

Do not introduce gold into the positive/negative event button backgrounds, and don't swap the button label font away from Inter (the brand doc reserves Barlow Semi Condensed for headings/display text, not small UI labels).

## General

- These three changes are independent — implement and can be reviewed/committed separately.
- After implementing, visually sanity-check the tracking screen at a typical tablet width (this screen is used courtside, one-handed) to confirm nothing wraps awkwardly or misaligns.
