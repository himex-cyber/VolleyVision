# VolleyVision

VolleyVision is a volleyball performance analytics web app: coaches track matches live, players see their own stats, and teams get analytics built from every recorded event. It is in beta, aimed at a February 2027 launch with a local club, with a mobile app planned after that.

## What it does

- **Auth and email verification** — register/login with a JWT session; every account must verify its email before it can join a team (invitation, join code, or claiming a player record). Password reset revokes existing sessions via a token version check.
- **Teams, privately** — a team is visible only to its owner, an accepted member, or an admin. There is no public team listing.
- **Coach roles** — one head coach (the team owner, changed only by ownership transfer) and up to two assistant coaches per team. The one-head-coach rule is also a database constraint.
- **Invitations and join codes** — email invitations with a role, plus regenerable player/staff join codes for joining a team directly.
- **Approval queue** — members on a restricted access tier get their mutations queued as `ApprovalRequest`s instead of applied immediately; the owner, a head coach or a manager approves or rejects them.
- **Roster and players** — player records, linking a user account to a roster entry, a player portal and a coach portal.
- **Match tracking** — live scoring, set/score adjustments, a scoreboard, and a spectator watch view.
- **Analytics** — match, team and player analytics and a match report, built from the event log.
- **Team chat** — one polled channel per team.
- **Feedback** — in-app feedback with optional attachments, reviewed by admins.

## Removed in September 2026

Leagues, match video (YouTube and upload), the AI assistant/match summary, heat maps, coaching/training/season recommendations, rotation analytics, momentum charts, and opponent scouting reports were all built, then deleted (not just flagged off) in a September 2026 audit that refocused the app on its core. They're recoverable from the git tag `pre-feature-removal`. See `CHANGELOG.md` for the full audit trail.

## Tech stack

- **Backend:** Express 4 + TypeScript 5 + Prisma 5, against Supabase Postgres.
- **Frontend:** React 18 + Vite 5 + TanStack Query 5 + Tailwind CSS 3.
- **Deployment:** Netlify — the frontend as static assets, the entire backend as one Netlify Function.
- **Error tracking:** Sentry (`@sentry/node` / `@sentry/react`).

## Repository layout

```
backend/                  Express + Prisma API
  src/routes/              Express wiring + validators, versioned under /api/v1
  src/controllers/         HTTP request/response shaping
  src/services/            Business logic, Prisma queries
  src/lib/                 Pure, testable helpers (no Prisma import)
  src/middleware/          Auth, visibility, permissions, rate limiting
  prisma/schema.prisma     Database schema
  netlify-functions/api.js Express app wrapped for Netlify Functions
frontend/                 Vite + React SPA
  src/pages/               Route-level page components
  src/components/          Shared UI, including PermissionGuard
  src/context/             AuthContext
  src/hooks/               TanStack Query hooks
  src/lib/                 Axios client, token storage
  src/config/features.ts   Feature flags
docs/design/               Design notes and mockups
docs/audit/AUDIT-LOG.md    September 2026 audit log
CHANGELOG.md               Release history, newest first
deploy.ps1                  Production deploy script
backup.ps1                  Production database backup (pg_dump in Docker)
```

## Local development

Prerequisites: Node 24 (see `.nvmrc`), the same version the live function runs.

**Important:** `backend/.env` points at the production Supabase database. Any `prisma` command run from `backend/` (migrate, studio, db push) hits production. The staging tooling is built (see "Staging and tests" below), but the staging project itself hasn't been created yet.

### Setup

```powershell
cd backend
copy .env.example .env
# fill in DATABASE_URL, DIRECT_URL, JWT_SECRET at minimum
npm install
npm run dev        # :3001, health at /health
```

In a second terminal, from the repo root:

```powershell
cd frontend
copy .env.example .env
npm install
npm run dev        # :5173, proxies /api/v1 to the backend in dev
```

Key backend env vars (see `backend/.env.example` for the full list): `DATABASE_URL` (pooled), `DIRECT_URL` (direct, migrations only), `JWT_SECRET` (required — auth 500s without it), `CLIENT_URL` (CORS origin), SMTP settings (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`; without them no email is sent, so nobody can verify their address or join a team), Supabase Storage settings (optional — degrades only attachment endpoints), `SENTRY_DSN`.

Key frontend env var: `VITE_API_URL` (leave unset locally; only needed when the frontend is served from a different origin than the API), `VITE_SENTRY_DSN`.

## Scripts

**Backend** (`cd backend`)

```bash
npm run dev              # ts-node-dev, :3001
npm run build            # tsc -> dist/
npm test                 # import-cycle check, then src/lib and src/__tests__
npm run test:integration # src/__integration__ against a LOCAL Postgres (refuses anything else)
npm run check:cycles     # import-cycle check
npm run db:generate      # prisma generate
npm run db:migrate       # prisma migrate dev (interactive)
npm run db:push          # prisma db push
npm run db:studio        # prisma studio
npm run db:seed          # prisma/seed.ts
npm run db:seed:staging  # staging seed users/teams/matches (refuses any non-staging DB)
```

**Frontend** (`cd frontend`)

```bash
npm run dev              # vite, :5173
npm run build            # tsc && vite build
npm run lint             # eslint 9 flat config, --max-warnings 0
npm run preview          # vite preview
```

## Testing

Backend tests are plain `assert`-based TypeScript files at `backend/src/lib/*.test.ts`, run directly by `ts-node` via `npm test`. They must stay pure logic — importing anything that pulls in `lib/prisma` instantiates a `PrismaClient` at module load, which needs a platform-specific engine binary the test runner doesn't have. This is why the static role-permission map lives in `lib/rolePermissions.ts`, separate from `services/permission.service.ts`.

Code that touches the database is tested with a fake Prisma client instead:
- A test file imports `src/testing/installFakePrisma.ts` **first**, which swaps `lib/prisma` in the module cache for a recording fake.
- The test then stubs only the calls it expects. Unstubbed calls throw.
- Assertions can check the exact `where` clause.

These tests live in `backend/src/__tests__/`, and `npm test` runs both folders. The `http.*.test.ts` files there start the whole Express app on a random port over the fake client, so they check middleware order and status codes the way a real request meets them.

There are no frontend tests yet.

GitHub Actions (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`/`develop`. It runs `prisma validate`, type-checks, the backend tests, the frontend lint and build, and a production dependency audit for both packages. Its `db` job starts a throwaway Postgres container, applies every migration from zero, checks `schema.prisma` hasn't drifted from the migrations, and runs the integration tests. CI never touches Supabase or deploys.

`backend/scripts/` holds the test runners, the import-cycle check, the staging seed, the smoke check and a few one-off maintenance scripts (`ensure-admin`, `backfill-team-join-codes`, `cleanup-orphaned-teams`). The maintenance scripts are not part of `npm test`, and the database ones run against production.

## Staging and tests

Every change is meant to be proven on staging (a second Supabase project and a second Netlify site) before production. The tooling is in place; the staging project is created when deploys resume.

- **Integration tests** (`backend/src/__integration__/`): the real app against a real, local Postgres. `authz-matrix.test.ts` is the single place authorization expectations live: every team-scoped route, called as an outsider, a viewer and a player. `rls.test.ts` checks every public table has row-level security on. Run them locally against a throwaway database with `DATABASE_URL=postgresql://…@localhost:…/… npm run test:integration`. The runner refuses any non-local database.
- **Staging seed** (`npm run db:seed:staging`): pre-verified users for every role plus an outsider, two teams and two matches. It refuses any database that isn't the staging project.
- **Smoke check** (`node backend/scripts/smoke.mjs <url>`): health, the CSP header and a 404 for an unknown team. With the `SMOKE_*` variables set, it also logs in as the staging seed users. `deploy.ps1` runs it after every deploy.
- **Staging config** lives in `backend/.env.staging` (gitignored; see `backend/.env.staging.example`).
- **Creating the staging site:** `netlify sites:create --disable-linking`, so the new site never becomes this folder's linked site.
- **Row-level security:** every new table must enable RLS in its own migration. `rls.test.ts` fails CI if one doesn't.

## Architecture

The backend is layered `routes/` (Express wiring + validators) -> `controllers/` (HTTP shape) -> `services/` (business logic, Prisma), with `lib/` holding pure helpers kept free of Prisma imports so they stay unit-testable. All routes are versioned under `/api/v1`, so a future `/api/v2` can be introduced without breaking older clients.

Team authorization is three stacked layers, and a new team-scoped endpoint needs to go through all of them:

1. **Visibility** — a team is visible only to its owner, an accepted membership, or a global admin. Anyone else gets a 404, not a 403, so team ids never leak.
2. **Role permissions** — a static `TeamRole` -> `Permission` map, with the team owner always resolved to head coach.
3. **Access tiers** — a per-member dial (`VIEW_ONLY`, `APPROVAL_REQUIRED`, `FULL_ACCESS`) on roster, invitation and match actions. `VIEW_ONLY` is rejected outright; `APPROVAL_REQUIRED` mutations become queued `ApprovalRequest` rows instead of applying immediately.

Rate limiting (login, register, password reset, join-code lookups) is backed by a Postgres token-bucket table rather than in-memory state, so every Netlify Function invocation shares the same budget instead of starting with an empty one.

## Database and migrations

Prisma against Supabase Postgres. `DATABASE_URL` is the pooled (pgbouncer) connection used at runtime; `DIRECT_URL` is the non-pooled connection used only for migrations.

Migrations are applied with, from `backend/`:

```bash
npx prisma migrate deploy
```

This must be run **before** deploying when the schema has changed. The Netlify build deliberately does not run migrations — the CLI masks secret env vars during a build, which makes `migrate` fail with error P1013.

## Deployment

From the repository root:

```powershell
.\deploy.ps1                   # production
.\deploy.ps1 -Target staging   # the staging site, using backend/.env.staging
```

The Netlify build, function and redirect config is `netlify.toml` at the repo root. `deploy.ps1` builds the site locally and publishes it (`netlify deploy --prod --build --site <id>`, always naming the target site), with a deploy message built from the current git state. It first runs `npx prisma migrate status` against the target's database and aborts if migrations are pending or the database is unreachable (`-SkipMigrationCheck` bypasses this). A production deploy also refuses a dirty working tree or a branch other than `main` unless you pass `-Force`. After deploying, it runs the smoke check: read-only against production, logged in as the seed users on staging. It requires the Netlify CLI to be logged in as the account that owns the site. Don't rely on a push to `main` to deploy: always use the script.

### Backups

Take a backup before every production migration and deploy (the Supabase free plan keeps no downloadable backups). With Docker Desktop running, from the repo root:

```powershell
.\backup.ps1                  # -> $HOME\Backups\vv-backup-<date>.sql
```

It reads `DIRECT_URL`, then `DATABASE_URL`, from `backend/.env` without printing them (the first that works is used), runs `pg_dump` from the `postgres:17` image, and uses Supabase's session pooler (port 5432) because `pg_dump` can't run through the transaction pooler. If Docker can't reach Supabase's direct host (it's IPv6-only), put the Session pooler URL from Supabase > Connect into `DIRECT_URL`. The URL reaches the container through the environment, never on its command line. The file holds every user's and player's data in plain text (emails, password hashes, players who can be minors): keep it private. The script refuses an `-OutDir` inside the repo, and `.gitignore` excludes `vv-backup-*.sql`. **Chat attachments aren't included**: they live in Supabase Storage.

A production `deploy.ps1` refuses to run unless today's backup exists in `$HOME\Backups` (`-NoBackup` overrides it).

## Building the Android app

The Android app is this same frontend in a Capacitor 8 shell (`frontend/android/`, app id `app.volleyvision`).
You need Android Studio (SDK platform 36, platform-tools, emulator, command-line tools) and **JDK 21** (Capacitor 8's
Gradle needs it; set `JAVA_HOME` to it when running `gradlew` from a terminal).

| Command (in `frontend/`) | What it does |
|---|---|
| `npm run android:local` | Builds for the emulator against the local API (`http://10.0.2.2:3001`, cleartext allowed) and syncs `android/` |
| `npm run android:prod` | Builds against production and syncs `android/`; required before every release build |
| `node scripts/check-android-prod.mjs` | Fails if the synced project could reach plain HTTP or load remote code (gradle also runs it before every release build) |
| `cd android && gradlew.bat installDebug` | Installs a debug build on a running emulator or USB device |
| `cd android && gradlew.bat assembleRelease bundleRelease` | Signed release APK and AAB, once `android/keystore.properties` exists |

- **Signing:** copy `android/keystore.properties.example` to `android/keystore.properties` (gitignored) and fill it
  in. Keep the `.jks` outside the repo and back it up; losing it means the app can't be updated as the same app.
- **Versions:** `versionName` in `android/app/build.gradle` is the one place the app version lives, for the iPhone
  app too (the app reports it as `X-Client: android/<version>`). Bump `versionCode` for every build shared with anyone.
- **Production API:** Netlify needs `CORS_EXTRA_ORIGINS=https://localhost,capacitor://localhost` (the Android and iPhone apps' origins), or every app request fails.
- **Icons and splash:** sources and the regeneration recipe are in `frontend/assets/`.
- **Emails** (verify, reset, invite) open the website, not the app.
- **Low-memory PCs:** the Play Store emulator images are heavy. A Google APIs ATD image with 1.5 GB RAM boots on 8 GB
  machines (it draws no screen; debug through `chrome://inspect` or the WebView DevTools socket).

## Building the iOS app

The iPhone app is the same frontend in a Capacitor 8 shell (`frontend/ios/`, a Swift Package Manager project:
`ios/App/App.xcodeproj`, scheme `App`, no CocoaPods). It is iPhone only, iOS 16.4 and later, and goes out through
**internal TestFlight** only for now. There is no Mac, so nothing iOS-specific builds locally: **Codemagic** builds,
signs and uploads it (`codemagic.yaml`, workflow `ios-testflight`).

| Command (in `frontend/`) | What it does |
|---|---|
| `npm run ios:prod` | Builds against production and syncs `ios/` (runs on Windows and Linux; no Xcode needed) |
| `node scripts/check-ios-prod.mjs` | Fails on a remote server URL, cleartext, a non-default origin, App Transport Security exceptions, a missing permission text, iPad or an iOS target other than 16.4, or an icon with alpha; warns while the web inspector is on |

CI's `ios-config` job runs both on Ubuntu and fails if the committed `ios/` differs from a fresh sync, so after
changing `capacitor.config.ts`, a plugin or the Xcode project, run `npm run ios:prod` and commit what it changes.

**Before the first build (Karlos, once):** an Apple Developer account (organisation, Himex Trading Ltd), the App ID
`app.volleyvision`, the app in App Store Connect, an App Store Connect API key (App Manager) added to Codemagic, an
Apple Distribution certificate and an App Store provisioning profile fetched into Codemagic, and an internal
TestFlight group with automatic distribution. Then replace the three `REPLACE_WITH_*` values in `codemagic.yaml`:
the key's name in Codemagic, the app's numeric Apple ID, and the email for build results. None of them is secret;
the key itself, certificates and profiles live only in Codemagic.

**Starting a build:** Codemagic → the VolleyVision app → **Start new build** → branch `main`, workflow
`ios-testflight`. Nothing starts a build automatically (no `triggering:` section), which keeps it inside the free
500 macOS minutes a month; a build takes about 10–20 minutes. Once Apple has processed the upload, the build
reaches the internal group's iPhones through TestFlight on its own.

- **Versions:** the app version is `versionName` in `frontend/android/app/build.gradle`, the same as Android's; the
  build writes it into the Xcode project. The build number is the latest TestFlight build number plus one, looked
  up during the build, so it never needs bumping by hand. The app reports itself as `X-Client: ios/<version>`.
- **Xcode:** pinned to 26.6 in `codemagic.yaml`. Apple takes uploads only from Xcode 26 or later (since 28 April
  2026), and Xcode 27.2's JSON project format breaks `cap sync`, so it isn't `latest`. When Apple raises its minimum
  (see developer.apple.com/news/upcoming-requirements), move the pin to the lowest Xcode that meets it and that
  Capacitor supports, and check Codemagic lists it. Keep the project in Xcode's classic `.pbxproj` format.
- **Web inspector:** the TestFlight workflow sets `CAP_IOS_INSPECTABLE=1`, so inspect.dev on Windows can show the
  app's console over USB. It is off in any other build and must be off for external testing or the App Store.
- **Production API:** needs `capacitor://localhost` in `CORS_EXTRA_ORIGINS` (see Building the Android app).
- **Device checks:** `docs/ios-device-checklist.md`.
- **Not yet:** push notifications, universal links (emails open the website in Safari), CSV and Print (hidden in
  the apps), and the App Store itself (Phase 9: account deletion, privacy policy link, chat reporting, age rating).

## Security

See "Architecture" above for the authorization model, and `CHANGELOG.md` / `docs/audit/AUDIT-LOG.md` for the September 2026 security audit (rate limiting, authorization fixes, dependency updates, privacy fixes).

## Further reading

- [CHANGELOG.md](CHANGELOG.md)
- [docs/audit/AUDIT-LOG.md](docs/audit/AUDIT-LOG.md)
- [docs/design/](docs/design/)
