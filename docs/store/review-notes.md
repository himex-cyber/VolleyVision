# Reviewer notes

Paste the text blocks into App Store Connect (App Review Information → Notes) and Play Console (App content → App access).
**Never put real credentials in this repo.** Enter the demo username and password in the consoles only.

Checked against: Apple App Review Guidelines 1.2 (user-generated content) and 5.1.1(v) (account deletion); Google's account deletion policy (https://support.google.com/googleplay/android-developer/answer/13327111, fetched 1 Oct 2026).

## Before you submit

1. Create a demo account in production (or the store-facing environment) with a coach role and a demo team that has a few matches and some chat. **Karlos to confirm** which environment reviewers will hit (production is the only one for now; there is no staging).
2. Create a second demo user on the same team so the reviewer can see chat between two people. **Karlos to confirm.**
3. Sign in on a clean device once to be sure the demo account works and the email is verified.
4. Make sure the demo team has no real people's data.
5. Fill the console username and password fields. Leave the repo without them.

## Apple: App Review Information

**Sign-in required:** Yes. **Username / Password:** enter the demo coach account in the fields (not in notes).

**Notes (paste):**

```
VolleyVision is a volleyball stats app. Coaches track matches live (it works offline and syncs later). Players and staff view stats and dashboards. Each team has a private chat.

Sign in with the demo account in the fields above. It is a coach on a demo team called "Demo Spikers" with sample matches and chat.

How to reach the main features:
- Tracking: open Matches, pick the open demo match, then Track. Tap a player and an action to log it.
- Dashboards and stats: open Matches, then a finished match, or the Team tab.
- Team chat: open the Chat tab (or the team's Chat). The demo team has a second member so you can see a conversation.
- Account deletion: Profile, then Account, then Delete account. Please use a throwaway account to test it; the demo account is shared. Web page: https://volleyvision-app.netlify.app/delete-account

Sign-up is for people 13 and over (tick box, no date of birth asked). Coaches can also add player records (name, jersey, position, stats) for people without accounts.

User-generated content and safety (Guideline 1.2):
- Chat is private to members of the same team. There are no public posts, feeds or strangers contacting each other.
- Filter: an objectionable-words filter runs on chat messages.
- Report: long-press or use the menu on a message, then Report. Reports are reviewed within 48 hours by the developer.
- Block: any member can be blocked from their messages. Blocked members' messages are hidden from you.
- Contact: support@volleyvision.co.nz and https://volleyvision-app.netlify.app/support

Privacy: no ads, no tracking, no analytics SDKs. Crash reports go to Sentry without user id, email or IP. Privacy policy: https://volleyvision-app.netlify.app/privacy

Permissions: camera and photo library are used only to attach a photo in chat. Nothing else uses them.

Contact: support@volleyvision.co.nz
```

**Karlos to confirm** the exact menu labels and tab names above before pasting (the wording is from the project description, not from reading the UI). Also add a **phone number** for the Apple contact field (Apple requires one; **Karlos to confirm**).

## Google Play: App access

Choose "All or some functionality is restricted" and add instructions. Enter the demo username and password in the console fields.

**Instructions (paste):**

```
Sign in with the demo coach account (username and password in the fields). It has a demo team called "Demo Spikers" with sample matches and team chat.

- Live tracking: Matches, open the demo match, Track. Tap a player then an action.
- Stats and dashboards: Matches, a finished match; or the Team tab.
- Team chat: Chat tab. Chat is private to team members.
- Report a message: message menu, Report. Reviewed within 48 hours.
- Block a member: from their message or profile.
- Delete account: Profile, Account, Delete account. Web: https://volleyvision-app.netlify.app/delete-account

Sign-up needs a tick box confirming the person is 13 or older. The app is not directed at children.
No ads. No tracking. No special hardware needed. The camera and photo picker are only used to attach a photo in chat.
```

Also:
- Ads: declare "No ads".
- Permissions declaration: only camera/photos if the manifest requests them. **Karlos to confirm** with the final Android manifest (minSdk 24, targetSdk 36).
- If the reviewer cannot receive email, the demo account must already be verified.

## If a reviewer asks

| Question | Answer |
|---|---|
| Why no sign in with Apple? | Sign in is email and password only, with no third-party login, so Apple's Sign in with Apple rule doesn't apply. |
| Can strangers contact each other? | No. Chat is only between members of the same team. |
| Are there in-app purchases? | No. **Karlos to confirm** this stays true at launch. |
| Who is responsible for under-13 player records? | The coach who adds them must have the player's (or a parent's) permission. The child has no account and cannot sign in. |
| How is a report handled? | Reviewed within 48 hours. The message snapshot is kept for the review; the reported message can be removed. |
