# iPhone device checklist (Phase 8.5)

For Karlos, on your own iPhone, with the TestFlight build. Claude can't drive the phone, so this is the only
check the iPhone app gets before anyone else uses it.

**Before you start**
- Production runs v9.15.0, and `CORS_EXTRA_ORIGINS` in Netlify includes `capacitor://localhost` (Part C3).
  Without both, sign-in fails with a network error.
- VolleyVision is installed from TestFlight. In TestFlight the build shows as version 9.15.0 with a build number.
- Use a team where you're the coach, with at least one scheduled match you can track.

**How to report back:** tick each box (`[x]`), write what you saw in the Notes, and take a screenshot of anything
that looks odd. Paste the whole file (or just the failures and notes) back to Claude with the screenshots.
Build number tested: ______  iPhone model: ______  iOS version: ______

## 1. Sign in and the screen edges

- [ ] **Sign in** with your normal account. You land on the home page.
  Notes:
- [ ] **Top of the screen:** the header sits below the clock and the notch or Dynamic Island. Nothing is hidden
  behind them, and the strip behind the clock is white while you scroll. Screenshot the home page.
  Notes:
- [ ] **Bottom of the screen:** scroll to the bottom of a long page (a team dashboard). The last item sits above the
  home bar, not under it. There's no second, inner scroll bar, and the page doesn't bounce into a grey gap.
  Screenshot it.
  Notes:
- [ ] **Status bar icons** (clock, battery) are dark and readable on the white header, including with the phone in
  dark mode.
  Notes:

## 2. Getting around (there's no Back button on an iPhone)

For each screen, check there's a visible way back or home (a Back link, the logo, or the menu), and that swiping from
the left edge does **not** go back.
- [ ] Teams list, team dashboard, Matches list, Roster, Chat
  Notes:
- [ ] A match's Stats dashboard
  Notes:
- [ ] Signed out: sign-in → **Create account** → back to sign in, and sign-in → **Forgot password** → back to sign in.
  After creating an account, the Welcome page has a way on to your teams.
  Notes:
- [ ] A match: Track, Events, Watch, and "Back to Matches"
  Notes:
- [ ] A player's page (tap a player in a stats table)
  Notes:
- [ ] Profile, Feedback, Invitations
  Notes:
- [ ] Swiping right from the left edge on any screen does nothing.
  Notes:

## 3. Tracking, online and offline

- [ ] **Online:** open a match's Track tab and record about 10 taps, including an Undo. The score updates and the
  sync badge settles.
  Notes:
- [ ] **Serving control:** Serving: Us/Them switches, and follows the point winner after a hand-added point.
  Notes:
- [ ] **Airplane mode:** turn it on and record 10 more taps. They show as waiting, and the score moves on the phone.
  Notes:
- [ ] **Force-quit while offline:** swipe the app away, reopen it (still in airplane mode). You're still signed in,
  the match opens, and the taps are still waiting.
  Notes:
- [ ] **Reconnect:** turn airplane mode off. The waiting taps send once. Check on the website that the event count
  and score match the phone and nothing is doubled.
  Notes:
- [ ] **Restart with taps waiting:** airplane mode on, record 5 taps, restart the phone, open the app, turn
  airplane mode off. The 5 taps send, and you're still signed in.
  Notes:
- [ ] **Landscape:** turn the phone sideways on the tracker. Every button is visible and tappable, and nothing is
  cut off by the notch.
  Notes:

## 4. Dashboards and copying

- [ ] Team and match dashboards load. The date filter (All matches, Last 30 days, Custom) changes the numbers.
  Notes:
- [ ] **Download CSV and Print are not shown** in the app (they're website-only for now).
  Notes:
- [ ] **Copy Report** on a match dashboard, then paste into Notes: the report text appears.
  Notes:
- [ ] **Copy the join code:** on the team page's Roster section, tap **Copy** next to "Player code", then paste
  it somewhere: the code appears.
  Notes:

## 5. Chat

- [ ] **Typing:** open team chat, tap the message box. The keyboard comes up, and the box you're typing in stays
  visible above it the whole time. Send a message. Screenshot it with the keyboard up.
  Notes:
- [ ] **Photo from the camera:** attach, choose Take Photo, take and send it. The app asks for camera permission
  the first time (with VolleyVision's reason) and doesn't close.
  Notes:
- [ ] **Photo from the library:** attach, choose Photo Library, send a normal iPhone photo (these are HEIC). It
  arrives and shows in the chat.
  Notes:
- [ ] **Opening an attachment:** tap a photo or file in chat. It opens in Safari; switching back to VolleyVision
  returns you to the chat.
  Notes:

## 6. Feedback

- [ ] Send feedback with a photo attached. On the Feedback page, tap the attachment: it opens in Safari.
  Notes:

## 7. Signing out and links

- [ ] **A link in an email** (for example, a password reset) opens the website in Safari, not the app. That's
  expected for now.
  Notes:
- [ ] **Sign out:** you land on the sign-in page. Reopen the app: still signed out.
  Notes:

## 7a. Staying signed in, and store-readiness screens (v9.17.0)

- [ ] **Updating keeps you signed in:** with an older build installed and signed in, and a few taps queued in
  airplane mode, install the new build. Open it: still signed in, and the taps are still waiting (they sync once
  you're back online). The sign-in and taps moved from browser storage to the phone's own storage.
- [ ] **Closing the app keeps taps:** queue taps in airplane mode, swipe the app away, reopen it: they're still there.
- [ ] **Terms:** an account that hasn't accepted the Terms sees the one-screen Terms step; the Terms and Privacy
  links open in Safari.
- [ ] **Report and block:** on someone else's chat message, Report shows the reason form and the thank-you; Block
  hides their messages; Profile → Blocked members unblocks.
- [ ] **Delete account:** Profile → Account → Delete account shows the explanation; with a throwaway account,
  deleting it lands on "Your account has been deleted", and reopening the app shows the sign-in page.

## 8. Anything else

Anything that looked wrong, slow or confusing, with screenshots:

Notes:

---

**If something breaks and there's no clue on screen:** Claude can usually see the error in Sentry. If not, the
app's console can be opened from Windows with inspect.dev over USB (on the iPhone first turn on
**Settings → Apps → Safari → Advanced → Web Inspector**). Its free tier allows two 15-minute sessions a day.
