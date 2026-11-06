# Product baseline (Phase 0)

[MVP plan](./MVP-PLAN.md) Phase 0: record how the **current** app behaves before feature work. This file is the written baseline: five usability tasks (operator-run), data census snapshots, and a test coverage map.

**Environment (this run)**  

- Date: 2026-11-06  
- OS: Linux (CachyOS)  
- Node: v26.13.0 (repo engines ask for Node 22; use `nvm use 22` when you want an exact match)  
- Branch / commit: recorded at write time from the working tree  

**Prerequisites used here**  

1. `npm ci` and `npx prisma generate` (CI runs `db:generate`; postinstall scripts may be blocked by npm `allowScripts`—generate explicitly if imports fail).  
2. Postgres reachable via `DATABASE_URL`, schema applied: `npx prisma migrate deploy`.  
3. Optional seed: `npm run db:seed` (jurisdictions + issue tag catalog only).  
4. Census report: `npm run db:census` (writes Markdown + JSON to stdout; redirect to a file under `docs/eval/`).

---

## T1–T5 task results (operator protocol)

Same tasks as [MVP-PLAN § Evaluation script](./MVP-PLAN.md#evaluation-script). **Not automated**: run in a browser with the dev server (`npm run dev`) and real Google sign-in for T4 unless you have another way to obtain a session.

Expected outcome from the plan: on an **empty** migrated DB (no seed, no instruments), **T1 and T2 stall** because there is no relevant instrument data to name on the heatmap or read in the matrix. T3 still passes (middleware + API behavior). T4/T5 need data and/or UI that surfaces freshness ([MVP-PLAN](./MVP-PLAN.md) notes T5 depends on showing `lastCheckedAt` or ingest run time—which is not yet on the public comparison page; see codebase search for `lastCheckedAt` usage).

| Task | Seeded catalog only (`npm run db:seed`) | Empty schema (migrate, no seed) | First stall sentence (notes) |
|------|----------------------------------------|----------------------------------|-----------------------------|
| **T1** Heatmap → hot state → `/?j=US,{code}` | Page loads; heatmap is uniform gray (0 relevant instruments). **No “hot” state** to name from data. User may pick any state tile; comparison may show “No data” for cells without `?j=` default ([Phase 1 gap](./MVP-PLAN.md)). | Same; no jurisdictions in DB breaks queries that expect FK rows—**treat as fail/dead end** until seed runs. | *"[To fill on run]"* |
| **T2** Read one issue + open a source | No bills in DB → matrix cells lack real instruments/sources. | Same as T1 empty case. | *"[To fill on run]"* |
| **T3** Signed out: `/triage`, no pencil, `PUT` → 401 | Redirect to `/sign-in`; unauthenticated `PUT` returns **401** JSON (`{ "error": "Unauthorized" }`) per middleware. | Same (does not depend on domain data). | — |
| **T4** Editor loop | Needs EDITOR session + at least one instrument row (seed does not create instruments). **Not completed** without ingest or manual DB fixtures. | Same. | *"[To fill on run]"* |
| **T5** Freshness | Public UI does not yet show comparison-level `lastCheckedAt` (field exists on `Instrument`; not surfaced on `/` /heatmap). Census still reports DB min/max when rows exist. | No `lastCheckedAt` rows. | *"[To fill on run]"* |

**Timing**: add wall-clock times when you run the script; targets are in the MVP task table (60s–4m per task).

---

## Data census

Machine-generated reports (stdout capture of `npm run db:census`):

| Database state | Report file |
|----------------|------------|
| After `migrate deploy` + `db:seed` | [eval/census-seeded.md](./eval/census-seeded.md) |
| After `migrate deploy` only (empty, optional `migrate reset --skip-seed`) | [eval/census-empty.md](./eval/census-empty.md) |

Each file includes Markdown tables, a JSON block for diffs, and explains gray heatmap tiles (0 relevant instruments, tag coverage, `lastCheckedAt` coverage).

---

## Test map (Vitest)

**Legend**

- **Unit-only**: mocks / no Postgres; runs in default `npm test` when Prisma client is generated.  
- **Postgres-gated**: `*.integration.test.ts` wrapped in `describe.skipIf(!process.env.TEST_DATABASE_URL)`; CI sets `TEST_DATABASE_URL` and mirrors `DATABASE_URL` in [vitest.config.mts](../vitest.config.mts).  
- **Missing in browser**: no Playwright (or other real browser) suite in repo yet; Phase 4 calls for Playwright CI ([MVP-PLAN](./MVP-PLAN.md)).

### By file

| File | Unit-only | Postgres-gated | Browser E2E |
|------|-----------|----------------|-------------|
| `src/app/(public)/page.test.ts` | Yes (mocks `auth`, `queries`) | | Missing |
| `src/app/api/cell-notes/route.test.ts` | Yes | | Missing |
| `src/app/api/cell-notes/route.integration.test.ts` | | Yes | Missing |
| `src/app/api/instrument-notes/route.test.ts` | Yes | | Missing |
| `src/app/api/instruments/[id]/route.test.ts` | Yes | | Missing |
| `src/app/api/instruments/[id]/route.integration.test.ts` | | Yes | Missing |
| `src/app/api/ingest/congress/route.test.ts` | Yes | | Missing |
| `src/app/api/ingest/legiscan/route.test.ts` | Yes | | Missing |
| `src/app/api/ingest/openstates/route.test.ts` | Yes | | Missing |
| `src/app/api/admin/users/route.test.ts` | Yes | | Missing |
| `src/app/api/admin/users/[id]/route.test.ts` | Yes | | Missing |
| `src/lib/ingest/index.test.ts` | Yes | | Missing |
| `src/lib/ingest/index.integration.test.ts` | | Yes | Missing |
| `src/lib/ingest/congress.test.ts` | Yes | | Missing |
| `src/lib/ingest/legiscan.test.ts` | Yes | | Missing |
| `src/lib/ingest/openstates.test.ts` | Yes | | Missing |
| `src/lib/ingest/state.test.ts` | Yes | | Missing |
| `src/lib/queries.test.ts` | Yes | | Missing |
| `src/lib/validation.test.ts` | Yes | | Missing |
| `src/lib/roles.test.ts` | Yes | | Missing |
| `src/lib/search-params.test.ts` | Yes | | Missing |
| `src/lib/is-desktop.test.ts` | Yes | | Missing |
| `src/middleware.test.ts` | Yes | | Missing |
| `electron/constants.test.ts` | Yes | | Missing |
| `electron/security.test.ts` | Yes | | Missing |
| `electron/window-state.test.ts` | Yes | | Missing |

**Gaps called out elsewhere**  

- Instrument notes `POST`/`DELETE`: mocked in `instrument-notes/route.test.ts` only—no `*.integration.test.ts` yet ([OPTIONAL-REMAINING.md](./OPTIONAL-REMAINING.md)).  
- Auth guards: server/API tested with mocks; no DB round-trip for session validation in tests ([PROGRESS.md](./PROGRESS.md)).

### Latest Vitest run (this doc update)

Run after `npx prisma generate`:

- Without `TEST_DATABASE_URL`: **352 passed**, **21 skipped** (integration suites), **26** test files (23 passed, 3 skipped files).  
- With `TEST_DATABASE_URL` + migrated DB (CI-style): **373 passed**, **0 skipped**, **26** test files all green (same command used against `127.0.0.1:54330/titleix_test` on 2026-11-06).

---

## Suggested commands (operator cheat sheet)

```bash
# Census: seeded catalog
export DATABASE_URL="postgresql://USER:PASS@localhost:5432/DBNAME"
npx prisma migrate deploy
npm run db:seed
npm run db:census > docs/eval/census-seeded.md

# Census: empty tables (destructive: drops data)
npx prisma migrate reset --force --skip-seed
npm run db:census > docs/eval/census-empty.md

# Full integration test run (matches CI)
export TEST_DATABASE_URL="$DATABASE_URL"
npm test
```
