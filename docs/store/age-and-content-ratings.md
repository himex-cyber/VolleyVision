# Age and content ratings

Sources:
- Apple update: https://developer.apple.com/news/?id=ks775ehf (fetched 1 Oct 2026). New tiers 4+, 9+, 13+, 16+, 18+. Answers were due 31 Jan 2026.
- Apple question detail: https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions (fetched 1 Oct 2026)
- Google IARC: https://support.google.com/googleplay/android-developer/answer/9859655 (fetched 1 Oct 2026)
- Google target audience page (https://support.google.com/googleplay/android-developer/answer/9285071): **could not be fetched (404)**. The Families notes below come from general knowledge. **Karlos to confirm** in the Play Console wording.

## Apple

VolleyVision has no violence, gambling, sexual content, alcohol, or medical claims. Answer "None" to all of those.

| Question | Answer | Note |
|---|---|---|
| Parental controls | No | None in the app |
| Age assurance | No | Only a "I am 13 or older" tick box at sign-up. No DOB, no ID or age estimation. |
| User-generated content | **Yes** (Claude's recommendation; **Karlos to confirm**) | Team chat, photos and files are user-generated content, even though each chat is private to its team. Guideline 1.2 applies either way, and the app has what it asks for: a word filter, reporting (reviewed within 48 hours), blocking and published contact details. Answering No risks a rejection if a reviewer finds chat. |
| Messaging and chat | **Yes** | Members of a team can message each other, with photos and files |
| Social media (feeds that amplify user content) | **No** (**Karlos to confirm**) | No public feed, no likes, no discovery, no public profiles. Team chat only. Answering Yes would force a 13+ minimum. |
| Social media disabled for under 13 | Not applicable | |
| Unrestricted web access | No | No in-app browser |
| Advertising | No | |
| Medical or wellness topics | No | Stats only. Height and weight are optional profile fields. |
| Mature/violent themes, gambling, etc. | None | |

Expected calculated rating: **4+** (messaging is allowed at 4+).

**Set a higher minimum age of 13+.** Apple lets you raise the rating after the questionnaire. Our Terms say 13+, chat exists, and players can be teenagers. 13+ matches the Terms and the tick box. **Karlos to confirm** you want to set 13+ manually.

Also note the App Review Guidelines on user-generated content (1.2) need: filter, report, block, contact info. All four exist. See `review-notes.md`.

## Google Play

### Target audience and content

| Question | Answer |
|---|---|
| Target age groups | **13-15, 16-17, 18 and over** only. Do **not** select 5 and under, 6-8, 9-12. |
| Does the app appeal to children? | No. It is a sports stats and coaching tool. |
| Ads in app | No |

Choosing only 13+ keeps the app out of the Families program and the Designed for Families rules. Do not tick any age under 13, even though a coach may add an under-13 player record. The records are made by a coach and the child has no account or access.

**Karlos to confirm** that a coach-entered player name, jersey number, position and stats for under-13s is acceptable in Google's eyes. The privacy policy already says a coach must have the player's (or a parent's) permission.

### IARC content rating questionnaire

Category: pick **Utility, Productivity, Communication or Other** (non-game). **Karlos to confirm** the exact label in the console.

| Question | Answer |
|---|---|
| Violence, blood, fear | No |
| Sexual content, nudity | No |
| Profanity or crude humour | No (the chat has a word filter; the app itself has none) |
| Controlled substances | No |
| Gambling or simulated gambling | No |
| Do users interact or exchange content with each other? | **Yes** (team chat, photos and files) |
| Does the app share the user's location with other users? | No |
| Can users purchase digital goods? | No |
| Is user-generated content moderated? | Yes: word filter, report (reviewed within 48 hours), block |
| Does the app let users share personal info publicly? | No. Everything is inside a team. |

Expected result: roughly **Everyone / PEGI 3 / USK 0**, with a "Users Interact" note. Some regions may show a higher tier because of chat. Apple and Google ratings need not match. Google's target audience (13+) is separate from IARC.

### Related Play Console sections

- Ads: No ads.
- News app / Government app / Financial features / Health apps: No.
- Data safety and account deletion: see `play-data-safety.md`.
