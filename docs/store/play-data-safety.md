# Google Play Data safety answers

Sources (fetched 1 Oct 2026):
- https://support.google.com/googleplay/android-developer/answer/10787469 (Data safety form)
- https://support.google.com/googleplay/android-developer/answer/13327111 (account deletion)

Facts: `data-inventory.md`. Where: Play Console → App content → Data safety.

## Top-level answers

| Question | Answer |
|---|---|
| Does your app collect or share any required user data types? | Yes (collect). Nothing shared. |
| Is all user data encrypted in transit? | **Yes** (HTTPS/TLS everywhere) |
| Do you provide a way for users to request data deletion? | **Yes** |
| Account creation method | Email and password |
| Delete account URL | https://volleyvision-app.netlify.app/delete-account |
| Partial deletion without deleting the account? | Yes: users can delete their own chat messages; coaches can delete player records. **Karlos to confirm** you want to state this. |
| Independent security review | No |
| Privacy policy URL | https://volleyvision-app.netlify.app/privacy |

## Collected vs shared

Google: **collected** means data leaves the device for us or our providers. **Shared** means it is transferred to a third party.
Google does **not** count a transfer to a **service provider** that processes data on our behalf and on our instructions as sharing.
Supabase (database and files), Netlify (hosting), Sentry (errors) and Google Gmail (sending email) are service providers.

So everything below is **Collected**, and nothing is **Shared**. We sell nothing and pass nothing to advertisers.

## Data types

Required means the user can't turn it off and still use the app. Optional means the user can decline.
Purposes are **App functionality** (plus **Account management** where noted). Do not tick analytics, advertising, personalisation or fraud prevention.

| Google category → type | Collected | Shared | Required / Optional | Purposes |
|---|---|---|---|---|
| Personal info → **Name** | Yes | No | Required | App functionality, Account management |
| Personal info → **Email address** | Yes | No | Required | App functionality, Account management |
| Personal info → **User IDs** | Yes | No | Required | App functionality, Account management |
| Personal info → **Phone number** | Yes | No | Optional | App functionality |
| Personal info → **Other info** (date of birth, city, country, preferred position, height, weight, bio) | Yes | No | Optional | App functionality |
| Photos and videos → **Photos** | Yes | No | Optional (chat attachments) | App functionality |
| Files and docs → **Files and docs** | Yes | No | Optional (chat attachments, up to 25 MB) | App functionality |
| Messages → **Other in-app messages** | Yes | No | Optional (chat, feedback, reports) | App functionality |
| App activity → **Other user-generated content** | Yes | No | Required for core use | App functionality. Match stats, notes, player records. |
| App activity → **Other actions** | Yes | No | Required | App functionality. Audit log, terms acceptance. |
| App info and performance → **Crash logs** | Yes | No | Required | App functionality (Sentry). No user id, email or IP. |
| App info and performance → **Diagnostics** | Yes | No | Required | App functionality (Sentry) |
| Device or other IDs | **No** | | | No advertising ID, no Android ID |
| Location, Contacts, Calendar, Audio, Financial, Web browsing | No | | | |

### Decisions for Karlos

- **Height and weight.** Google's "Health and fitness" category is for health info and exercise data. Height and weight typed into a profile is not clearly either. Simplest honest answer: list under **Personal info → Other info** and leave Health and fitness off. **Karlos to confirm**, or remove the two fields (cleanest).
- **IP address.** Rate-limit records keep IPs for up to an hour. Google has no IP type. **Karlos to confirm** you're happy not declaring it.
- **Camera and photos.** Used only to attach a chat photo. No extra row is needed, because nothing leaves the device until the user sends it.
- **Families.** Not applicable. Target audience is 13+ (see `age-and-content-ratings.md`).

## Data deletion details

- In app: Profile → Account → Delete account.
- Web: https://volleyvision-app.netlify.app/delete-account. Google requires this page to name the app and be easy to find.
- Deleted with the account: profile, messages and attachments, blocks, feedback, tokens, on-device data.
- Kept after deletion: a player record linked to the account becomes "Former player" and keeps its stats. Audit log entries stay with the user shown as "deleted-user" and email and id removed. A moderation report keeps its reason and time, but the message snapshot is blanked if the reported person deletes their account.
- Google says retained data must be explained to users, for example in the privacy policy. **Karlos to confirm** the delete-account page lists the same retained items as privacy.html.
- Backups: local database backups on Karlos's PC. **Karlos to confirm** how long they are kept. Google allows up to 90 days for backups, so say so on the page if that holds.

## Before you submit

1. The privacy policy URL loads and matches this form.
2. Answers match the real SDKs: Sentry only. No Firebase, no ads.
3. App access instructions are filled in (`review-notes.md`).
