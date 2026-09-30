# Setting up staging (Karlos, about 30 minutes)

Staging is a second copy of VolleyVision: its own Supabase project (database and file storage) and its own Netlify
site. Releases are rehearsed there before production. Nothing on staging may point at production, and production
data never goes to staging.

Claude writes the code and checks names; **you create the accounts and hold every secret.** Never paste a secret
into the chat. When you're done, tell Claude "staging ready".

Before you start:
- **Supabase's free plan allows two active projects.** Production is one, so staging is the second. If an old
  test project is still active, pause or delete it first.
- **Netlify:** a staging deploy is a build like a production one and uses the same account's credits. Check you have
  room for a few builds (each rehearsal is one).

## 1. Supabase project

1. Look up production's region first: Supabase dashboard → the **Volley Vision** project → Project Settings →
   General → **Region**. Tell Claude the region too (the privacy policy needs it).
2. Create a new project in the **same organisation and the same region**:
   - Name: `volleyvision-staging`
   - Database password: generate a strong one and store it in your password manager.
   - Plan: Free.
3. When it's ready, note its **project ref** (the id in the dashboard URL,
   `supabase.com/dashboard/project/<ref>`). It must not be `rkkhrmhorgdqkxflipui` (that's production).

## 2. Storage bucket

1. In production: Storage → the `team-chat` bucket → **Edit bucket**. Write down its **file size limit** and its
   **allowed MIME types**.
2. In staging: Storage → **New bucket**:
   - Name: `team-chat`
   - **Public bucket: off** (private)
   - The same file size limit and allowed MIME types as production.

The app reaches the bucket with the service-role key only; no storage policies are needed.

## 3. The staging database connection strings

In the staging project: **Connect** (top of the dashboard) → **ORMs** → Prisma. You need two strings:
- `DATABASE_URL`: the **transaction pooler** (port 6543), ending in `?pgbouncer=true`.
- `DIRECT_URL`: the **session pooler** (port 5432).

Both contain the password. They go into Netlify (step 4) and your local `backend/.env.staging` (step 5), nowhere else.

## 4. Netlify site

Run from the repo root, signed in to the Netlify CLI as **himextradingltd**:

```powershell
npx netlify-cli@26.2.0 sites:create --disable-linking --name volleyvision-staging
```

`--disable-linking` stops the CLI linking this folder to the new site; `deploy.ps1` always names the site with
`--site`, so production and staging can't be mixed up. Note the new **site id** it prints. If the name is taken, pick another; the URL becomes
`https://<name>.netlify.app`.

Then set the site's environment variables in the Netlify dashboard (Site configuration → Environment variables →
Add a variable). The dashboard keeps secrets out of your shell history. Use scope **All** and the same value for
every deploy context.

| Variable | Value |
|---|---|
| `DATABASE_URL` | staging transaction pooler string (step 3) — mark **secret** |
| `DIRECT_URL` | staging session pooler string (step 3) — mark **secret** |
| `NODE_ENV` | `production` (the Postgres rate limiter only runs in production mode) |
| `CLIENT_URL` | the staging URL, e.g. `https://volleyvision-staging.netlify.app` |
| `CORS_EXTRA_ORIGINS` | `https://localhost,capacitor://localhost` |
| `JWT_SECRET` | a **new** random value, never production's: `openssl rand -base64 48` or your password manager's generator — mark **secret** |
| `JWT_EXPIRES_IN` | `7d` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | a separate test mailbox if you have one. If you reuse production's Gmail, **staging emails really send** (invites and password resets go to real addresses) |
| `SUPABASE_URL` | the **staging** project's URL (Project Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | the **staging** project's service-role key — mark **secret** |
| `SUPABASE_CHAT_BUCKET` | `team-chat` |
| `SENTRY_DSN` | the same DSN as production (errors are told apart by environment) |
| `SENTRY_ENVIRONMENT` | `staging` |
| `VITE_SENTRY_DSN` | the same as production's `VITE_SENTRY_DSN` |
| `VITE_SENTRY_ENVIRONMENT` | `staging` |

Tell Claude the site id and URL (neither is secret). Claude reads the names back with
`netlify env:list --site <id>`; that proves the names are set, not their values.

## 5. Your local `backend/.env.staging`

Copy `backend/.env.staging.example` to `backend/.env.staging` (gitignored) and fill it in:
`DATABASE_URL`, `DIRECT_URL` and `STAGING_PROJECT_REF` from steps 1–3, `NETLIFY_STAGING_SITE_ID` and `STAGING_URL`
from step 4, a `SEED_PASSWORD` of 12+ characters, and the `SMOKE_*` values (the seed users' password is
`SEED_PASSWORD`). Claude never reads this file.

## 6. Tell Claude "staging ready"

Claude then runs, from the repo root:

```powershell
.\deploy.ps1 -Target staging -Migrate   # prisma migrate deploy against staging
.\deploy.ps1 -Target staging -Seed      # the seed users and teams (refuses any non-staging database)
.\deploy.ps1 -Target staging            # build, publish to the staging site, smoke check
```

`-Migrate` and `-Seed` load `backend/.env.staging` for that one step, refuse it if it points at production, print no
values, and stop without deploying. Supabase projects already have the `anon` and `authenticated` roles, so the
row-level-security migration applies as it did on production.

**The proof it's staging:** the smoke check signs in as the `staging+…@volleyvision.test` seed users, which exist
only in the staging database. `/health` reports only `{status, db}`, so it can't tell the two databases apart.
