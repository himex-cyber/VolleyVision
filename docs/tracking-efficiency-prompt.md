# Prompt: Reduce tracking friction on the live match tracker

Paste this into Claude Code from the `VolleyVision` repo root.

---

Improve the live match tracking UI in `frontend/src/pages/TrackingPage.tsx` (and its child `frontend/src/components/tracking/CourtZoneSelector.tsx`) to cut down on taps and visual scanning during a live match. Three changes, described below. Read the existing file first — it already has patterns (`CATEGORIES` array, `keepZone` checkbox, `EVENT_META`) that these changes should reuse, not replace.

## 1. Focus mode: All / Attack / Defense

Add a mode toggle (three-way, similar styling to the existing "Recording for: Us / Opponent" toggle at the top of the event area) that filters which of the six `CATEGORIES` groups render:

- **All** (default, current behavior) — every category shown.
- **Attack** — only `attack`, `serve`, `set` categories (matches `EVENT_META[].category`).
- **Defense** — only `pass`, `block`, `defence` categories.

Implementation notes:
- `EVENT_META` already tags each event with a lowercase `category` field (`'attack' | 'serve' | 'pass' | 'block' | 'defence' | 'set'`) and `CATEGORIES` labels line up with it — filter `CATEGORIES` by category rather than hardcoding event lists.
- Store the mode in local component state (`useState`), not persisted — consistent with how `keepZone`/`selectedRotation` work today. Default to `'all'`.
- Don't hide the player roster, score controls, zone selector, or rotation selector — only the event-button groups are filtered.

## 2. Position-aware roster ordering

The player grid (`players.map(...)`) currently renders in whatever order `match.team.players` comes back in. Sort (don't hide/filter) it based on the active focus mode so the most relevant players surface first:

- **Defense mode active** → `LIBERO` and `DEFENSIVE_SPECIALIST` players first, then everyone else in original order.
- **Attack mode active** → `OUTSIDE_HITTER`, `OPPOSITE`, `MIDDLE_BLOCKER` first, then everyone else in original order.
- **All mode** → unchanged current order.

Every player must still be tappable regardless of position — this is a sort for convenience, never a filter, since any player can technically dig, pass, set, or attack.

## 3. Recently-used players quick strip

Correction to something I said earlier: `selectedPlayer` already persists across events today (there's no reset-after-record for the player, only for `selectedZone` via `keepZone`), so a "keep player" checkbox would be redundant. The actual friction is switching *between* 2–3 players who alternate on a given stat (e.g. two passers trading serve-receive duty) and having to find them in an 8+ tile grid each time.

Add a small horizontal strip of up to 3 "recently used" player chips, most-recent-first, shown above the main roster grid:

- Track distinct player IDs from the last several `recordEvent` calls in local state (dedupe, most recent first, cap at 3).
- Exclude the currently-selected player from the strip (they're already visible as selected in the grid below).
- Tapping a chip selects that player, same as tapping their tile in the main grid.
- Hide the strip entirely if there's no history yet (fresh match) or fewer than 1 prior distinct player.
- This only applies in "Us" recording mode, not opponent mode (opponent events don't select a player).

## General constraints

- Match the existing visual language: `clsx`, Tailwind utility classes already used in the file (`bg-gold-500`, `border-grey-200`, `rounded-xl`/`rounded-lg`, etc.) — no new component libraries.
- Keep everything keyboard/touch-friendly for tablet use (this screen is used courtside on a tablet, one-handed).
- Don't change the event-recording logic (`handleRecord`), the API calls, or the data model — this is purely a front-end UX/filtering change on top of existing state and data.
- After implementing, do a self-review pass: confirm switching Focus modes doesn't clear `selectedPlayer`, `selectedZone`, or `selectedRotation`, and that toggling modes back to "All" restores every category.
