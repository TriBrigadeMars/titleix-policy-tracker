# Work done so far

Title IX Policy Tracker is a signed-in Next.js 15 app (App Router, Prisma/Postgres, Auth.js Google OAuth, Tailwind/shadcn) for comparing state and federal law that can affect Title IX.

Honest status: the **read/compare + cell-note write**, **Congress.gov ingest**, **editor triage**, **50-state heatmap**, and **admin user-role management** slices are real and structurally sound. Public view is not.

Merged through [PR #6](https://github.com/TriBrigadeMars/titleix-policy-tracker/pull/6) on `main`.

## What exists

### Auth and roles

- Google OAuth via Auth.js v5 with the Prisma adapter (DB sessions, not JWT).
- Roles: `READER` < `EDITOR` < `ADMIN`. New users default to `READER`.
- Three gates, documented in `ARCHITECTURE.md`:
  - `src/middleware.ts` — cookie presence only. Not a security boundary.
  - `src/app/(protected)/layout.tsx` — authoritative page gate (`auth()`).
  - `src/lib/auth-guards.ts` — `requireUser()` / `requireRole()` for APIs.
- `src/lib/roles.ts` mirrors the Prisma `UserRole` enum so `tsc` works before `prisma generate`.
- Sign-in page, site header with role badge and sign-out.

Do not "simplify" this. Do not call `auth()` from edge middleware.

### Domain schema and seed

- Jurisdictions: `US` + 50 states (`FEDERAL` | `STATE`).
- Eight issue tags (matrix rows), seeded in `prisma/seed.ts`.
- `Instrument` with types `BILL` | `STATUTE` | `REGULATION` and statuses `PROPOSED` | `PASSED` | `EFFECTIVE` | `ENJOINED` | `REPEALED`.
- Unique `(jurisdictionId, type, identifier)` so ingest can upsert.
- `InstrumentIssueTag` junction, `InstrumentNote`, `CellNote` (unique on jurisdiction x issue tag).
- Cell note body: zod + `@db.VarChar(10000)`.
- Initial migration: `prisma/migrations/20260918000000_init`.
- CI runs `prisma migrate deploy` against workflow Postgres, then lint, typecheck, build, test.

### Comparison matrix (the working product)

- Selected jurisdictions live in `/?j=US,CA,TX` (codes, max 8, min 2 to render).
- `(protected)/page.tsx` is an RSC: loads jurisdictions, then in parallel issue tags, Title IX-relevant instruments, and cell notes via `src/lib/queries.ts`.
- `Dashboard` / `JurisdictionSelector` only update the URL. They do not fetch.
- `ComparisonMatrix` is presentational: indexes notes and instruments by cell, extracts `MatrixCell`.
- Editors get a pencil; `CellNoteEditor` `PUT`/`DELETE`s `/api/cell-notes`. `canEdit` is display-only.

### Writes

Cell notes are the only mutation.

- `PUT /api/cell-notes` — upsert on `(jurisdictionId, issueTagId)`. `authorId` from session, never the body. Updates do not reassign author.
- `DELETE /api/cell-notes?id=` — `deleteMany`, 404 if missing.
- Strict zod in `src/lib/validation.ts` (`z.strictObject`).
- List GETs for instruments and cell notes require `jurisdictionIds` (max 8) and share `src/lib/queries.ts`. Instruments default to `isTitleIXRelevant: true`.

### Tests

Vitest, mocked Prisma/auth. Covers roles, cell-note validation, cell-note 401/403/upsert author, comparison query parsing, and typed `where` builders.

No DB-backed integration tests yet.

## What a thermo-nuclear review already fixed

Before PR #6 the dashboard was a client fetch graph: three `useEffect`s, jurisdictions loaded twice, unbounded `Record<string, unknown>` Prisma filters, no migrations, no instrument unique key.

That was rejected as a foundation. The replacement rules still apply:

- Reads belong on the server (RSC + search params) unless a mutation needs a tiny client call.
- Query logic lives in `src/lib/queries.ts`, not in route handlers or components.
- Do not grow `comparison-matrix.tsx` into heatmap + triage + citations. Extract.
- Do not add `if`s to shared paths for a new feature. Give the feature its own module.
- No file past 1000 lines without a structural reason.

### Second review (2026-09-18 PRs #10, #11, #12)

A post-merge review of the triage, heatmap, and admin slices fixed eight findings:

1. The tri-state relevance encoding is now centralized in `src/lib/triage.ts` (`triageStatus()` / `triageWhere()`), replacing scattered inline derivations in `queries.ts` and `triage-dashboard.tsx`.
2. The duplicated `describeError` helpers collapsed into `src/lib/fetch-error.ts` (`describeFetchError()` with per-editor option overrides).
3. Pages now use a shared `requirePageRole()` redirect guard in `src/lib/auth-guards.ts` instead of re-rolling auth checks in `triage/page.tsx` and `admin/page.tsx`.
4. `instrument-triage-editor.tsx` now builds the parent instrument once via a single `deriveUpdatedInstrument` helper (was three hand-rolled rebuilds).
5. `toInstrument` is typed from Prisma payload types via `instrumentInclude` / `instrumentNoteInclude` (no hand-stubbed notes type).
6. The heatmap tooltip no longer hardcodes "of 8"; `totalIssueTags` is aggregated and threaded through.
7. Dead read endpoints/functions (`getInstrumentById`, `getUserById`, `GET /api/instruments/[id]`, `GET /api/admin/users/[id]`) were removed with their tests.
8. `ALL_ROLES` is an `as const` tuple driving `z.enum(ALL_ROLES)`, and list parsing shares `parseBoundedLimit()`.

## What is not done

| Gap | Notes |
|-----|--------|
| Public heatmap vs signed-in compare | Product is sign-in-to-read. Architecture still mentions public users. |
| Integration tests | CI applies migrations but tests never hit Postgres. |
| Extra instrument types | `GUIDANCE`, `EXECUTIVE_ORDER`, `COURT_ORDER` need an explicit migration when needed. |

## Canonical files (do not fork)

| Concern | Home |
|---------|------|
| Reads | `src/lib/queries.ts` |
| List query params | `src/lib/search-params.ts` |
| Write validation | `src/lib/validation.ts` |
| Authz | `src/lib/auth-guards.ts`, `src/lib/roles.ts` |
| Auth config | `src/lib/auth.ts` |
| Client DTOs | `src/types/index.ts` |
| Dates in UI | `src/lib/format-date.ts` |
| Domain rules | `ARCHITECTURE.md` |

## Ingest (Congress.gov federal bills)

- `src/lib/ingest/index.ts` — the data layer. `RawInstrument` type
  (source-agnostic, keyed by jurisdiction code), `IngestAdapter` interface,
  and `upsertInstruments()` which resolves jurisdiction codes to ids, then
  upserts on `(jurisdictionId, type, identifier)` inside a single transaction.
- Machine fields (title, status, dates, sourceUrl, rawSummary, lastCheckedAt)
  are overwritten on update. Editor fields (isTitleIXRelevant,
  relevanceConfidence) are never touched by ingest — that is human triage.
- `src/lib/ingest/congress.ts` — `mapCongressBills()` pure mapper
  (Congress.gov bills JSON → `RawInstrument[]`, skips malformed bills) and
  `congressAdapter` implementing `IngestAdapter` (fetches via Congress.gov v3
  API, optional `CONGRESS_GOV_API_KEY` env).
- `POST /api/ingest/congress` — ADMIN-only trigger. Query params `congress`
  (default 119) and `limit` (default 50, capped at 100). Returns
  `{ source, total, upserted, skipped }`. Returns 502 on upstream failure.
- Tests: `upsertInstruments` (mocked Prisma — jurisdiction resolution, unique
  key, editor-field preservation, skip-on-unknown-code, transaction), Congress
  mapping (table-driven, 7 cases), route authz (401/403/ADMIN/502/param
  clamping).

## Editor triage & Instrument notes

- `src/app/(protected)/triage/page.tsx` — RSC page for reviewing unreviewed, relevant, and not relevant instruments with bounded filters (`jurisdiction`, `status`, `relevance`, `limit`). Gate checks `EDITOR` role and redirects non-editors.
- `src/components/triage-dashboard.tsx` & `src/components/instrument-triage-editor.tsx` — client UI for filtering instruments and opening dialog to mark relevance, set confidence, attach issue tags, and create/delete instrument notes.
- `PATCH /api/instruments/[id]` — EDITOR-only endpoint for setting `isTitleIXRelevant`, `relevanceConfidence`, and atomically synchronizing issue tags (`InstrumentIssueTag` junction).
- `POST /api/instrument-notes` & `DELETE /api/instrument-notes?id=` — EDITOR-only endpoints for managing `InstrumentNote` records. `authorId` is strictly session-derived (`guard.user.id`).
- Strict zod schemas in `src/lib/validation.ts`: `instrumentTriageSchema`, `instrumentNoteCreateSchema`.
- Query layer: `instrumentTriageWhere`, `getInstrumentsForTriage` in `src/lib/queries.ts`. The tri-state relevance encoding (unreviewed/relevant/not-relevant) lives in `src/lib/triage.ts` (`triageStatus`, `triageWhere`) so the query layer and the dashboard badge UI stay in sync.
- Tests: route unit tests for `PATCH /api/instruments/[id]` and `POST`/`DELETE /api/instrument-notes` covering 401/403/400/404, Zod schema validation tests, and query where builder tests.

## 50-State Heatmap

- `src/app/(protected)/heatmap/page.tsx` — RSC page for a national overview visualizing Title IX policy and legislative activity across all 50 states + DC + federal jurisdiction.
- `src/components/state-heatmap.tsx` — 12×8 positioned grid tile layout representing all 51 jurisdictions with dynamic HSL color-scaling based on Title IX relevance volume, interactive sidebar detail cards, and direct deep-links into the comparison matrix (`/?j=US,{code}`).
- `src/lib/queries.ts` — `getHeatmapSummaries()` aggregates per-jurisdiction metrics (`relevantCount`, `pendingCount`, `issueTagCount`, `cellNoteCount`) plus a shared `totalIssueTags` (all seeded tags) via parallel Prisma queries and in-memory joins without raw SQL or schema migrations. The tooltip renders "X of N" from `totalIssueTags` rather than a hardcoded 8.
- `src/types/index.ts` — `HeatmapSummary` interface exported for clean DTO boundaries.
- `src/components/site-header.tsx` — "Heatmap" link added to the main navigation for all authenticated users.

## Admin User-Role Management

- `src/app/(protected)/admin/page.tsx` — RSC page for viewing and filtering all registered users. Authoritatively gated to `ADMIN` role (redirects non-admins).
- `src/components/admin-user-table.tsx` — client component with real-time role updating (`READER`, `EDITOR`, `ADMIN`), search filter, role filter, clear filters, and self-demotion prevention indicator.
- `src/components/site-header.tsx` — "Admin" link in main navigation rendered only for users with `ADMIN` role.
- `GET /api/admin/users` — ADMIN-only endpoint for listing users with bounded search, role, and pagination limit filters via `parseUserListQuery`.
- `PATCH /api/admin/users/[id]` — ADMIN-only endpoint for updating user roles. Enforces self-demotion prevention (`guard.user.id === id && role !== "ADMIN"`).
- Strict zod schema in `src/lib/validation.ts`: `userRoleUpdateSchema` (`z.strictObject`).
- Query layer in `src/lib/queries.ts`: `userListWhere`, `getUsers`, `userSummarySelect`, `toUserSummary`.
- Tests: route unit tests for `GET /api/admin/users` and `PATCH /api/admin/users/[id]` covering 401/403/400/404/self-demotion/success; validation tests; query where builder tests; and search-param parsing tests.

## Suggested next slice

1. Postgres integration tests for migrate + upsert ingest.
2. More ingest adapters (LegiScan, OpenStates) — now just implement
   `IngestAdapter` and add a route; the upsert path is reusable.
3. Public heatmap/matrix view for anonymous users.

See `docs/ORCHESTRATOR.md` for how to run that work.
