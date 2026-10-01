# Screenshots and graphics

Requirements checked 1 Oct 2026:
- Apple: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications
- Google: https://support.google.com/googleplay/android-developer/answer/9866151

## Sizes

### Apple (iPhone only)

- 1 to 10 screenshots. `.jpeg`, `.jpg` or `.png`. **No alpha channel.**
- **6.9" is the one to provide.** Portrait accepted sizes: 1260 × 2736, 1290 × 2796 or 1320 × 2868.
- 6.5" (1284 × 2778 or 1242 × 2688) is only needed if you skip 6.9". Apple scales 6.9" shots down for smaller phones.
- No iPad screenshots (iPhone-only app).

### Google Play (phone)

- Minimum 2, up to 8. JPEG or 24-bit PNG, no alpha.
- Each side 320 px to 3840 px. Portrait 9:16 (for example 1080 × 1920 or larger).
- **Feature graphic: 1024 × 500**, JPEG or 24-bit PNG, no alpha. Required to publish.
- App icon: 512 × 512, 32-bit PNG with alpha, max 1024 KB.
- Tablet screenshots are optional.

**Karlos to confirm** in the consoles when uploading, because upload limits can change. The Play screenshot page gave no separate 7-inch or 10-inch tablet rule.

## Screens to capture (6 to 8, in this order)

| # | Screen | What to show | Caption (short) |
|---|---|---|---|
| 1 | Live tracking, mid-rally | Tracking screen with a rally in progress, player selected, action buttons visible | Track every rally live |
| 2 | Match dashboard | Finished match with team totals and set scores | See the match at a glance |
| 3 | Player stats | One player's stats table | Know who is hitting |
| 4 | Team dashboard | Season or recent matches overview | Your whole team, one view |
| 5 | Team chat | A chat with a photo and a few messages | Talk it through with your team |
| 6 | Offline sync badge | Tracking screen showing the offline/queued badge | No signal? Keep tracking |
| 7 | Roster | Team roster with jersey numbers and positions | Build your roster |
| 8 | Court-zone heat map (match or team dashboard) | Restored in v9.8.0 | Use the demo club's data |

**Heat map:** removed on 2026-09-27 and restored in Phase 4 (v9.8.0), so it's in the app. Don't show anything that isn't.

## How to capture

- Android: on the emulator (a Pixel-style portrait device). Use the emulator screenshot button, then check the file is at least 1080 × 1920.
- iPhone: later, when a device or simulator build exists. **Karlos to confirm** who captures it. Until then, the Android shots can't be used for Apple (wrong sizes and status bar).
- Turn on demo mode: full battery, clean clock, no notifications.
- Capture in light or dark, but be consistent across all shots.

## Demo data rules

- Demo team only, made-up names (for example "Demo Spikers", "Alex Demo", "Sam Test"). **No real people, and above all no real minors.**
- No real photos in chat. Use a neutral stock volleyball image you own or a plain graphic.
- No real emails, phone numbers or school names anywhere on screen.
- Check the profile and chat screens for leftover real data before export.

## Feature graphic (Google)

1024 × 500. Dark background, VolleyVision wordmark, one line: "Live volleyball stats. Courtside." A phone mock-up of shot #1 on the right. No text in the outer 10 percent. No store badges. **Karlos to confirm** logo files and brand colours.
