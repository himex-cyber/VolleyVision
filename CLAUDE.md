# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `backend/` or `frontend/` — there is no root-level package.json.

**Backend** (`cd backend`)
```bash
npm run dev              # ts-node-dev on :3001, health at /health
npm run build            # tsc → dist/
npm test                 # runs every src/lib/*.test.ts sequentially via scripts/run-tests.js
npx ts-node --transpile-only src/lib/scoring.test.ts   # run ONE test file
npm run db:generate      # prisma generate
npm run db:migrate       # prisma migrate dev (interactive)
npm run db:studio
npm run db:seed
```

**Frontend** (`cd frontend`)
```bash
npm run dev              # vite on :5173
npm run build            # tsc && vite build
npm run lint             # eslint, --max-warnings 0
```

**Deploy** (from repo root): `.\deploy.ps1` — builds locally and publishes to Netlify prod with an auto-generated deploy message. It aborts if `prisma migrate status` reports pending migrations. Schema changes must be applied first with `cd backend; npx prisma migrate deploy` — the Netlify build deliberately does **not** run migrations (the CLI masks secret env vars, so migrate fails with P1013).

Dev servers are also defined in `.claude/launch.json` (`backend`, `frontend`, `frontend-preview`).

### Tests

There is no test framework. Tests are plain `assert`-based TypeScript files at `backend/src/lib/*.test.ts`, executed directly by ts-node. They must stay **pure logic** — importing anything that pulls in `lib/prisma` instantiates a PrismaClient at module load and makes the suite depend on a platform-specific engine binary. This is why the static role→permission map lives in `lib/rolePermissions.ts` separate from `services/permission.service.ts`.
## Architecture

Two-package monorepo: an Express + Prisma REST API and a Vite/React SPA, both deployed to Netlify — the frontend as static assets, the **entire backend as a single Netlify Function** (`backend/netlify-functions/api.js` wrapping the Express app via `serverless-http`). `src/index.ts` skips `app.listen()` when `process.env.NETLIFY` is set. `netlify.toml` rewrites `/api/v1/*` to that function so the SPA uses a same-origin relative base URL with no `VITE_API_URL`.

**Backend layering:** `routes/` (Express wiring + validators) → `controllers/` (HTTP shape) → `services/` (business logic, Prisma) with `lib/` holding pure, testable helpers. All routes are versioned under `/api/v1`.

### Authorization — three stacked layers

Do not add a team-scoped endpoint without going through all three:

1. **Visibility** (`lib/teamVisibility.ts`, `middleware/visibility.ts`) — a team is visible only to its owner, an accepted `TeamMembership`, or a global `ADMIN`. Everyone else gets **404, not 403**, so team ids never leak. There is no public-team concept.
2. **Role permissions** (`lib/rolePermissions.ts` → `services/permission.service.ts`) — static `TeamRole` → `Permission` map. The team owner is always resolved to `HEAD_COACH`. Enforced by `requireTeamPermission` / `requireMatchPermission` / `requireEventPermission` / `requireChannelPermission` in `middleware/permissions.ts`, which differ only in how they resolve `teamId` from the request.
3. **Access tiers** (`AccessCategory` = roster | invitation | match) — a per-member dial: `VIEW_ONLY` is rejected by `requireTeamAccess`; `APPROVAL_REQUIRED` and `FULL_ACCESS` both pass the middleware, and the **controller** decides queue-vs-immediate. `APPROVAL_REQUIRED` mutations become `ApprovalRequest` rows handled by `approval.service.ts`.

Global `UserRole.ADMIN` is separate from team roles (`requireAdmin`).

### Removed features

Leagues, match video, the assistant / AI match summary, heat maps, recommendations, rotation analytics, momentum and opponent scouting were **deleted** on 2026-09-27 (not flag-disabled — gone, tables dropped). Git tag `pre-feature-removal` holds the last version with them; `docs/audit/AUDIT-LOG.md` lists exactly what was removed. Bringing one back means restoring from that tag and writing a new migration. Note Netlify Functions cap a request payload at ~6 MB, which is why video bytes must never pass through the API if video returns.

### Frontend

`AuthContext` (JWT in `lib/tokenStorage.ts`) and `ViewModeContext` (coach vs player portal; the toggle only renders for dual-capability users) wrap the app. Server state is entirely TanStack Query — `lib/api.ts` is the axios client and `hooks/index.ts` the query/mutation layer; `ViewModeContext` deliberately reuses the same query keys so the cache is shared. `components/ui/PermissionGuard.tsx` mirrors backend permissions in the UI, but is presentation only — the server check is the real one.

`src/config/features.ts` holds the feature flags (only `teamChat` today). A feature that "doesn't exist" may have been deliberately removed — see "Removed features" above before rebuilding it.

### Database

Prisma against Supabase Postgres. `DATABASE_URL` is the pgbouncer pooled connection used at runtime; `DIRECT_URL` is the non-pooled one used only for migrations. `binaryTargets` includes `rhel-openssl-3.0.x` to match the Node 22 Lambda runtime pinned in `netlify.toml` — changing `NODE_VERSION` there changes which OpenSSL the deployed query engine needs.

`events` is the central fact table every analytics calculation aggregates from, indexed on `(matchId, setNumber)`, `(playerId, eventType)` and `recordedAt`. `match.setScores` is JSON rather than a normalised table.

Migrations are frequently hand-written and applied with `prisma migrate deploy` (see `~/.claude` memory on the Windows EPERM issue with `prisma generate` while the dev server is running).

### Known structural issues

- Import cycle: `invitation.service.ts → teamMembership.service.ts → teamActions.service.ts → invitation.service.ts`.
- `README.md` describes "Phase 1" only and is substantially out of date — the API reference and project structure in it no longer match the codebase. Prefer `CHANGELOG.md` and `docs/design/*` for current behaviour.

## Repo conventions

- `graphify-out/GRAPH_REPORT.md` is a generated knowledge graph of the codebase (communities, god nodes, hyperedges). Cheaper to consult than crawling for architecture questions.
- Comments in this codebase explain *why* a constraint exists (vendor limits, platform caps, revert plans), not what the code does. Match that when adding them.
