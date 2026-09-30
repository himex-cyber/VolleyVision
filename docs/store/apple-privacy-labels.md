# Apple App Privacy ("nutrition label") answers

Source: https://developer.apple.com/app-store/app-privacy-details/ (fetched 1 Oct 2026).
Facts: `data-inventory.md`, `frontend/public/privacy.html`.
Where: App Store Connect → App Privacy. Privacy Policy URL: https://volleyvision-app.netlify.app/privacy

## Top-level answers

| Question | Answer |
|---|---|
| Do you or your third-party partners collect data from this app? | **Yes** |
| Do you or your third-party partners use data for tracking? | **No**. We don't link data with third-party data for ads, and we don't share it with data brokers. No ad SDKs, no analytics SDKs. |
| Is any data type used for third-party advertising, developer advertising or analytics? | No, for all of them (see table). |

"Linked to identity" means tied to the user's account. All account data below is linked.
Sentry reports carry no user id, email or IP, so they are **not linked**.

## Data types

Tracking is **No** on every row.

| Apple category → type | Collected? | Linked? | Purpose (tick only this) | Why |
|---|---|---|---|---|
| Contact Info → **Name** | Yes | Yes | App Functionality | Account name; player record names |
| Contact Info → **Email Address** | Yes | Yes | App Functionality | Sign-in, verification, invites |
| Contact Info → **Phone Number** | Yes | Yes | App Functionality | Optional profile field, only the user sees it |
| Contact Info → Physical Address | No | | | City and country only (see Other Data) |
| User Content → **Photos or Videos** | Yes | Yes | App Functionality | Photos attached in team chat |
| User Content → **Emails or Text Messages** | Yes | Yes | App Functionality | Team chat messages |
| User Content → **Other User Content** | Yes | Yes | App Functionality | Match stats and notes, player records, chat files (up to 25 MB), bio |
| User Content → **Customer Support** | Yes | Yes | App Functionality | Feedback and message reports |
| Identifiers → **User ID** | Yes | Yes | App Functionality | Account id |
| Identifiers → Device ID | No | | | No advertising id, no device id |
| Diagnostics → **Crash Data** | Yes | **No** | App Functionality | Sentry. No user id, email or IP. |
| Diagnostics → **Performance Data** | Yes | **No** | App Functionality | Sentry: app version, device type |
| Other Data → **Other Data Types** | Yes | Yes | App Functionality | Optional profile: date of birth, city, country, height, weight, preferred position. Terms-acceptance date and version. |
| Usage Data → Product Interaction | No | | | No analytics. Audit log entries are security records, not usage analytics. |
| Location, Contacts, Financial, Health (HealthKit), Browsing, Purchases, Sensitive Info | No | | | |

### Things to watch

- **Date of birth.** Apple has no DOB type. It goes under Other Data Types. It is optional and only the user sees it.
- **IP addresses.** Rate-limit records hold an IP or email for minutes to an hour. Apple excludes data sent only to service a request and not retained. These are kept briefly, so it is borderline. Apple has no IP type. Simplest answer: add no row. **Karlos to confirm.**
- **Under-13 player records.** A coach enters name, jersey, position and stats. The child gives us nothing. It is covered by Name and Other User Content.
- **Purposes.** Do not tick Analytics, Product Personalization or any advertising purpose.

## Height and weight: is it Health & Fitness?

Apple's "Health" type is data from HealthKit, Clinical Health Records or health research. "Fitness" is data from the Motion and Fitness API. VolleyVision uses none of these.
Height and weight are optional numbers the user types into their own profile. Nobody else sees them.

Simplest honest answer: declare them under **Other Data Types**, not Health & Fitness. The privacy policy already lists them.
A strict reviewer could call height and weight "health". For zero doubt, also tick **Health** (linked, App Functionality). It only makes the label bigger.

**Karlos to confirm:** (a) Other Data Types only, (b) also tick Health, or (c) remove the height and weight fields before launch. Option (c) is cleanest and also simplifies the Google form.

## Optional-disclosure exemption

Apple lets some optional, infrequent data be left off the label. Our optional fields sit on the profile screen and are part of the normal profile, not prompted each time. So **disclose them**. Don't rely on the exemption.

## Related items in App Store Connect

- Privacy Policy URL: https://volleyvision-app.netlify.app/privacy
- Account deletion is required for apps with sign-up. It exists (Profile → Account → Delete account). Say so in the review notes.
- Privacy manifest is already in the app (commit 5b62333). **Karlos to confirm** at the first TestFlight build that Xcode's privacy report matches this table.
