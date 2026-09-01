# Prompt: Recent Events feed + Recording/Focus banner sizing

Paste this into Claude Code from the `VolleyVision` repo root. All changes are in `frontend/src/pages/TrackingPage.tsx`.

## 1. Bigger "Recent Events" header

The header is currently the `<Link to={`/matches/${matchId}/events`}>` wrapping "Recent Events" / "View all ›", styled at `text-xs font-medium`. Bump it to read like an actual section header — `docs/brand/BRAND-GUIDELINES.md`'s type scale documents an `h3` (1.125rem / Inter 600) specifically for "sub-sections, table headers," so target roughly that (e.g. `text-lg font-semibold`) rather than picking an arbitrary size. Keep the "View all ›" affordance and hover behavior, just scaled to match — it can stay visually secondary to the "Recent Events" label itself.

## 2. Cap the feed at 5 rows

`recentEvents` is currently `[...(events ?? [])].reverse().slice(0, 6)`. Change the `6` to `5`.

## 3. Row layout: avatar replaces the jersey-number text, full name, timestamp far right

Each row currently shows, in order: outcome dot → set badge → event label → `#{jerseyNumber} {lastName}` text → zone badge → rotation badge → timestamp → avatar circle (jersey number in a circle, currently the last/rightmost element, only rendered when `event.player` exists).

Change to: drop the `#{jerseyNumber}` prefix from the player text and change `{event.player.lastName}` to the full name (`{event.player.firstName} {event.player.lastName}`) — the avatar circle already carries the jersey number, so showing it twice is redundant. Move the avatar circle from its current position (after the timestamp, at the far right) to sit immediately before the name text, replacing the spot the jersey number used to occupy inline. The timestamp should end up as the last/rightmost element in the row once the avatar moves earlier — don't add extra `ml-auto`/ordering hacks, just relocate the avatar block in the JSX and the timestamp naturally becomes the trailing element.

Keep the existing `min-h-[60px]` row sizing and the `min-w-0`/`truncate` treatment on the text so a long full name still shrinks gracefully rather than pushing the row wider than the card, same as it does today for `lastName`.

## 4. Larger Recording-for / Focus banner

The "Recording mode toggle" card (`Recording for: Us / Opponent`, plus the `Focus: All / Attack / Defense` toggle in the same row) is currently small — `text-xs` labels, `px-4 py-2` buttons. Size both up for legibility: labels to roughly `text-sm`/`text-base`, and both sets of toggle buttons (Us/Opponent *and* All/Attack/Defense — they're visually paired in the same banner, so keep them matched rather than sizing only one) to around a 36px target height (Tailwind `h-9`), consistent with the touch-target sizing already used elsewhere on this screen (e.g. the score correction buttons are `w-11 h-11`). Increase padding/font-size together rather than just font-size, so the buttons actually grow, not just the text inside them. The opponent jersey-number `<input>` next to these toggles should probably scale up to match for visual consistency — use your judgment, but don't leave it looking mismatched against taller buttons next to it.

## After implementing

Check the banner and the events feed at typical tablet width — confirm the taller Recording-for/Focus row doesn't wrap awkwardly, and that a long player full name in the events feed still truncates cleanly instead of breaking the row height.
