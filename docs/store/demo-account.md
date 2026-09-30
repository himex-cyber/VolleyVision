# The store reviewers' demo account (production)

Apple (guideline 2.1) and Google both need a working sign-in with realistic data to review the app. It must hold
**no real people's data and no minors**. No script writes to production: you make it through the app, just before
you submit. About 15 minutes.

Staging already has one for rehearsals: `npm run db:seed:staging` creates `staging+reviewer@volleyvision.test` (or
`REVIEWER_EMAIL` from `backend/.env.staging`) owning "Demo Volleyball Club". Its password is `SEED_PASSWORD`.

## 1. The account

1. Pick an address you control and won't use for anything else, for example `appreview@volleyvision.co.nz` (an alias
   of the support mailbox is fine).
2. On https://volleyvision-app.netlify.app/register, sign up as **App Reviewer**. Tick the 13+ / Terms box.
3. Generate a strong password in your password manager. **It goes only into App Store Connect (App Review
   Information → Sign-in required) and the Play Console (App content → App access).** Never in the repo, a chat or
   an email.
4. Verify the email from the link you receive.

## 2. The team

1. Create a team: **Demo Volleyball Club**, division "Premier", season "2026".
2. Add seven players with made-up adult names, for example: Ava Setter #2 (Setter), Ben Spiker #4 (Outside hitter),
   Cleo Block #6 (Middle), Dev Swing #8 (Opposite), Esi Digs #10 (Libero), Finn Wing #13 (Outside hitter), Gia Middle
   #15 (Middle).
3. Post two messages in Team chat, for example "Welcome to Demo Volleyball Club. Training is Tuesday 6 pm."

## 3. Matches

1. Create a match against "Harbour City VC" dated last week, open **Track**, and record a set or two:
   - set **Serving: Us** at the start of each set;
   - tap a spread of events (serves, passes, kills, digs, blocks, errors) on different players and court zones;
   - finish at least one set, then mark the match Completed.
2. Do the same for a second match against "Southern Stars" (a shorter one is fine).
3. Create an upcoming match against "Northern Lights" next week, with a venue, so the home page shows a next match.

Check the match dashboard, the team dashboard and the heat map all show data.

## 4. In the stores

- **Apple:** App Store Connect → the app → App Review Information: tick "Sign-in required", enter the email and
  password, and paste the notes from `review-notes.md`.
- **Google:** Play Console → App content → App access: "All or some functionality is restricted", add the
  credentials and the same notes.

## 5. After review

Keep the account while the app is in review or live, since reviewers use it again for each update. Don't delete
the team: account deletion is refused while it owns one, which is also a quick way to show reviewers that rule.
Change the password if it's ever shared anywhere else.
