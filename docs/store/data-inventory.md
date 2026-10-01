# VolleyVision data inventory

Written from the code on 1 October 2026 (v9.17.0 work, branch `rebuild/p9-store-readiness`). It is the source for
`frontend/public/privacy.html`, the Apple privacy labels and the Google Play data-safety form. **Not legal advice.**
Items marked **Karlos to confirm** are facts the code can't show.

**In one paragraph:** VolleyVision is a volleyball stats app run by Himex Trading Ltd (New Zealand). Coaches track
matches; players and staff see stats and talk in team chat. Players can be under 18, and coaches can add players who
have no account. There is no advertising, no analytics SDK and no tracking. Data is stored with Supabase and hosted on
Netlify, both overseas.

## 1. What is stored, why, who sees it, how long

| Data | Why | Who can see it | Optional? | Kept until |
|---|---|---|---|---|
| **Account:** email, name, password (as a bcrypt hash) | Sign-in, and your name in your teams | Name: your teams. Email: members who manage the roster, and team owners. Password hash: nobody. | Required | Account deletion |
| Email verification and password-reset tokens (hashes) | Prove email ownership; reset a password | Nobody | n/a | Used, replaced or account deletion (valid 24 h and 1 h) |
| Terms acceptance (date and version) | Record of consent to the Terms (13+) | You | Required to post in chat | Account deletion |
| **Profile:** bio, phone, date of birth, city, country, height, weight, preferred position | Your own profile | Only you (no team, member or admin screen shows them) | All optional | Account deletion (or you clear them) |
| Profile image link | Avatar | Your teams | Optional (no upload yet; links must be on our own storage host) | Account deletion |
| **Team membership:** team, role, access level, join date | Permissions | Your teams | n/a | Leaving the team, team deletion or account deletion |
| **Player records:** name, jersey number, position | The team roster | Everyone on the team | Required for a record | Team deletion, or a coach deletes the record. Account deletion renames a linked record "Former player" and keeps its stats. |
| **Match stats** (events per player: type, set, zone, rotation, time, optional coach note) | The app's purpose | Individual stats: team staff who track, a global admin, and the player themself. Everyone else on the team: team totals, their own row. | n/a | Team or match deletion; a deleted player record takes its stats with it |
| Matches (opponent, date, venue, competition, scores) | Fixtures and results | The team | Some fields optional | Team deletion |
| **Team chat** messages and attachments (photos, files up to 25 MB) | Team communication | Team members. Other members' account ids are never sent to the app. | Optional | Deleting a message erases its text and files. Account deletion erases all your messages. Team deletion erases the team's chat. |
| Blocks (who you blocked) | Hide a member's chat messages from you | You | Optional | Unblock or either account's deletion |
| **Feedback and message reports** (subject, text, attachments, page, admin notes; a report keeps a snapshot of the reported message) | Bug reports, requests, moderation | You and the global admin (Himex Trading Ltd) | Optional | Your account's deletion. A report's snapshot is blanked if the reported person deletes their account; the reason and time stay. |
| **Invitations** (invitee email, role, code) | Invite someone to a team | Staff who can invite; the invitee | n/a | Expire after 7 days (row kept, marked expired) until the team or the invitee's account is deleted |
| Approval requests (pending changes, may hold names and emails) | Staff changes that need approval | Team managers | n/a | Team deletion; the requester's account deletion; emails removed when the invitee's account is deleted |
| **Audit log** (who did what, when; invitation email in some entries) | Security and team history | Not shown in the app | n/a | Kept. On account deletion the entries stay with the user replaced by "deleted-user", and their email and id removed. |
| **Rate-limit records** (keys include IP address, email or account id) | Stop abuse (login attempts, spam) | Nobody | n/a | Minutes to an hour (swept once the limit refills); deleted with the account |
| Server logs (Netlify Functions): request paths | Operating the service | Himex Trading Ltd | n/a | Netlify's log retention (**Karlos to confirm** the plan's retention) |
| **Error reports (Sentry, US):** error, stack trace, page path, app version, device/browser type | Fix crashes | Himex Trading Ltd | n/a | Sentry's retention for the plan. No user id or email is attached. Server events have IPs, request bodies, cookies, query strings and auth headers removed; the Sentry organisation stores no IP addresses (set by Karlos, 1 Oct). |
| **On the device:** sign-in token, cached name, recent match rosters, queued offline taps | Offline use | You (on your device) | n/a | Sign-out (taps stay until synced); account deletion clears all of it. Apps: phone storage (UserDefaults / SharedPreferences); web: browser storage. |
| **Local backups** of the whole database (`vv-backup-*.sql`, Karlos's PC) | Recovery | Himex Trading Ltd | n/a | **Karlos to confirm** how long they're kept |

**Players and minors:** accounts are 13+ (tick box at signup; no date of birth asked). Coaches can add player records
for anyone, including under-13s and people without accounts: a record holds only a name, jersey number, position and
match stats. The coach who adds a record is responsible for having the player's (or a parent's) permission.

**No:** advertising, ad SDKs, analytics SDKs (no Google Analytics, Firebase, Facebook, Amplitude), cross-app
tracking, data sales, location, contacts, health data. (Height and weight are optional self-entered profile fields;
**Karlos to confirm** whether to keep them — see `apple-privacy-labels.md`.)

## 2. Processors (service providers)

| Processor | What for | Where | Data |
|---|---|---|---|
| Supabase | Database and file storage | Singapore (AWS ap-southeast-1; from the pooler host, 1 Oct; Karlos to confirm in Dashboard → Project Settings → General) | Everything above except device data |
| Netlify | Website hosting and the API (one function) | Global CDN; functions in the US by default | Requests in transit; request-path logs |
| Sentry (Functional Software Inc.) | Error reports | US (`ingest.us.sentry.io`) | Scrubbed errors |
| Google (Gmail) | Sending email | Google's servers | Recipient address and the email (verification, password reset, invitation, report notice, deletion confirmation) |
| Apple, Google Play, Codemagic | Building and distributing the apps | US and global | App binaries; no user data from the app |

All are service providers acting for Himex Trading Ltd. No data is sold or shared for advertising.

## 3. Your rights (NZ Privacy Act 2020)

Access and correction on request to the support address; deletion in the app (Profile → Account → Delete account)
or by email from the account's address (processed with `backend/scripts/delete-account.ts`); complaints to the Office of
the Privacy Commissioner (privacy.org.nz).

## 4. Security

HTTPS everywhere; passwords hashed with bcrypt; sessions are signed tokens that deleting the account (or resetting
the password) ends; row-level security on every table with public-API access revoked; private file bucket with
one-hour signed links; team data visible only to that team's members.
