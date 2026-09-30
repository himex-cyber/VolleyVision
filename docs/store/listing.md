# Store listing copy

Limits checked 1 Oct 2026: Google title 30, short description 80, full description 4000
(https://support.google.com/googleplay/android-developer/answer/9859152). Apple subtitle 30, promotional text 170, keywords 100, description 4000
(App Store Connect field limits; **Karlos to confirm** in the console when pasting).

## Shared fields

| Field | Value |
|---|---|
| App name | VolleyVision |
| Primary category | Sports |
| Secondary category (Apple, optional) | Productivity (**Karlos to confirm**) |
| Support URL | https://volleyvision-app.netlify.app/support |
| Privacy URL | https://volleyvision-app.netlify.app/privacy |
| Marketing URL | None (leave blank) |
| Support email (Google contact) | support@volleyvision.co.nz |
| Copyright (Apple) | © 2026 Himex Trading Ltd |
| Bundle / package id | app.volleyvision |
| Pricing | **Karlos to confirm** (assumed free, no in-app purchases) |

## Apple

**Subtitle (30):** `Volleyball stats, courtside` (27)

**Promotional text (170):**
```
Track every rally live, even with no signal. See who is hitting, serving and passing well, and talk it through with your team in one place.
```
(139)

**Keywords (100, comma-separated, no spaces):**
```
volleyball,stats,coach,scouting,scorekeeper,rotation,team,chat,match,tracker,serve,spike,libero
```
(96) Do not repeat the app name or category; Apple already indexes them.

**What's new (first release):**
```
First release of VolleyVision. Track matches live, see player and team stats, and chat with your team.
```

## Google Play

**Short description (80):**
```
Live volleyball stats for coaches, players and teams. Works offline.
```
(68)

## Full description (both stores, under 4000)

```
VolleyVision is a volleyball stats app for coaches, players and team staff.

Track the match as it happens. Tap to log serves, passes, attacks, blocks and errors while the rally is live. No signal in the gym? Keep going. VolleyVision saves your taps on the phone and syncs them when you are back online.

FOR COACHES
- Live tracking by player, set, zone and rotation
- Add a note to any action
- Match dashboards with team and player totals
- Build your roster with names, jersey numbers and positions
- Invite players and staff, and choose who can do what

FOR PLAYERS AND STAFF
- See your own stats and how the team is going
- Follow match results and upcoming fixtures
- Keep your profile to yourself: details like phone, date of birth, height and weight are optional and only you can see them

TEAM CHAT
- Message your team in one place
- Share photos and files from match day
- Report a message or block a member if something is not right
- Chat is private to your team members

PRIVACY FIRST
- No ads
- No tracking
- No analytics SDKs
- Delete your account any time from Profile, then Account, then Delete account

VolleyVision is for people 13 and over. Coaches can add roster records for players who do not have an account, and should have the player's (or a parent's) permission.

Built in New Zealand by Himex Trading Ltd.

Questions? support@volleyvision.co.nz
```

Notes for Karlos:
- Only claims features that exist today. Removed features (video, AI summaries, leagues, scouting) are not mentioned on purpose. Court-zone heat maps were removed on 2026-09-27 but restored in Phase 4 (v9.8.0), so they exist; the home page shows each team's next match.
- "Upcoming fixtures" assumes the events/calendar feature is live. **Karlos to confirm.**
- "Sync when back online" matches the offline queue described in the data inventory.
