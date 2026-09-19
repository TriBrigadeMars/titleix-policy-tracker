# Work done so far

Title IX Policy Tracker is a signed-in Next.js 15 app (App Router, Prisma/Postgres, Auth.js Google OAuth, Tailwind/shadcn) for comparing state and federal law that can affect Title IX.

Honest status: the **read/compare + cell-note write**, **Congress.gov ingest**, **editor triage**, **50-state heatmap**, and **admin user-role management** slices are real and structurally sound. Public read of the comparison matrix and heatmap is real too; everything that writes is still signed-in.

Merged through [PR #15](https://github.com/TriBrigadeMars/titleix-policy-tracker/pull/15) on `main`.

On top of that, this branch carries the **2026-09-18 thermo-nuclear fix stack** (Phases 1–3: ingest reliability, triage encoding, heatmap SQL aggregation, chunked ingest, fail-closed API keys). Those commits are on this branch — **not necessarily merged to `main` yet**, and there is no PR number for them to cite. Phase 4 (this change) is docs + dedup only: it extracts the duplicated ingest route helpers and corrects this documentation. It adds no product behavior.

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

- Jurisdictions: `US` + 50 states + `DC` (seeded as `STATE`).
- Eight issue tags (matrix rows), seeded in `prisma/seed.ts`.
- `Instrument` with types `BILL` | `STATUTE` | `REGULATION` and statuses `PROPOSED` | `PASSED` | `EFFECTIVE` | `ENJOINED` | `REPEALED`.
- Unique `(jurisdictionId, type, identifier)` so ingest can upsert. A second optional unique `(source, sourceId)` keys rows by their stable upstream id.
- Editor triage encoding is `TriageStatus` (`UNREVIEWED` | `RELEVANT` | `NOT_RELEVANT`), centralized in `src/lib/triage.ts`. `isTitleIXRelevant` stays on the row because the matrix filters on it directly; ingest must never overwrite triage fields or `status` on update.
- `InstrumentIssueTag` junction, `InstrumentNote`, `CellNote` (unique on jurisdiction x issue tag).
- `InstrumentNote.authorId` and `CellNote.authorId` are optional and `onDelete: SetNull`, so deleting a user keeps their notes.
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

Vitest. Unit tests mock Prisma/auth: roles, cell-note validation, cell-note 401/403/upsert author, comparison query parsing, and typed `where` builders.

`src/lib/ingest/index.integration.test.ts` runs `upsertInstruments` against a
real Postgres — create-on-first-sight, in-place update, editor-field
preservation, unknown-jurisdiction skip, `(jurisdictionId, type, identifier)`
identity, whole-batch rollback on a database error, and the Congress.gov
mapper→DB path end to end. It is gated on `TEST_DATABASE_URL` and skips when
unset, so `npm test` still passes without a database; when set, the vitest
config points `DATABASE_URL` at the same database. CI sets it to the Postgres
service container, so migrations are now exercised by the tests, not just
applied.

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
| Public heatmap vs signed-in compare | The heatmap and comparison matrix are now anonymously readable at `/heatmap` and `/`; triage, cell-note writes, and admin remain signed-in only. |
| Extra instrument types | `GUIDANCE`, `EXECUTIVE_ORDER`, `COURT_ORDER` need an explicit migration when needed. |
| Integration test breadth | Ingest, cell-note writes, and the triage `PATCH` are DB-backed. Auth guards still rely on mocked Prisma. |
| Public anonymous view | Read-only matrix + heatmap are public; the pages carry a signed-out note pointing at `/sign-in`, and editor chrome stays off without a session. |
| Write-path integration tests | Covered by `*.integration.test.ts` alongside the route unit tests: cell-note `PUT`/`DELETE` and instrument triage `PATCH`, including that a re-ingest does not clobber editor triage or lifecycle status. These skip unless `TEST_DATABASE_URL` is set (CI sets it); auth guards are still mocked-Prisma only. |

Phase 4 (the current change) is **docs + dedup only** — it extracts
`INGEST_GENERIC_ERROR` / `paramInt` into `src/lib/ingest/route-helpers.ts` and
corrects this documentation. It does not build the public view, add instrument
types, or widen integration-test coverage.

The public view slice sits on top of it: `/` and `/heatmap` render for anonymous
visitors, each with a short signed-out note linking to `/sign-in`. Editing is
decided by `canEditRole(session)` in `src/lib/roles.ts`, which is `true` only for
a signed-in `EDITOR`/`ADMIN`; anonymous visitors are given no synthetic role.
Triage, cell-note writes, ingest, and admin stay behind `src/lib/auth-guards.ts`.

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
| Ingest route plumbing | `src/lib/ingest/route-helpers.ts` |

## Ingest (Congress.gov federal bills)

- `src/lib/ingest/index.ts` — the data layer. `RawInstrument` type
  (source-agnostic, keyed by jurisdiction code), `IngestAdapter` interface,
  and `upsertInstruments()` which resolves jurisdiction codes to ids per chunk,
  then upserts on `(jurisdictionId, type, identifier)`.
- Machine fields (title, status, dates, sourceUrl, rawSummary, lastCheckedAt)
  are overwritten on update. Editor fields (isTitleIXRelevant,
  relevanceConfidence, triageStatus) and `status` are never touched by ingest —
  that is human triage and lifecycle correction.
- Writes are chunked: `INGEST_CHUNK_SIZE` (50) rows per `$transaction`. Each
  chunk commits on its own, so a later chunk failure leaves earlier chunks
  committed and the error is rethrown. Retry is idempotent because the write
  keys on `(jurisdictionId, type, identifier)` and only rewrites machine fields.
- Upstream fetches abort after `FETCH_TIMEOUT_MS` (10s).
- All three adapters fail closed when their API key is missing; they never issue
  an unkeyed request.
- `src/lib/ingest/congress.ts` — `mapCongressBills()` pure mapper
  (Congress.gov bills JSON → `RawInstrument[]`, skips malformed bills) and
  `congressAdapter` implementing `IngestAdapter` (fetches via Congress.gov v3
  API, requires `CONGRESS_GOV_API_KEY`).
- `POST /api/ingest/congress` — ADMIN-only trigger. Query params `congress`
  (default 119) and `limit` (default 50, capped at 100). Returns
  `{ source, total, upserted, skipped }`. Returns a generic 502 body on upstream
  failure; the real error (which can carry API keys or internal URLs) is logged
  server-side only.
- `src/lib/ingest/route-helpers.ts` — `INGEST_GENERIC_ERROR` and `paramInt()`
  (clamp + truncate, fallback on non-finite) shared by all three trigger routes.
  Each route keeps its own limits and its own POST handler.
- Tests: `upsertInstruments` (mocked Prisma — jurisdiction resolution, unique
  key, editor-field preservation, skip-on-unknown-code, chunked transactions),
  Congress mapping (table-driven, 7 cases), route authz (401/403/ADMIN/502/param
  clamping).

### State bill ingest (LegiScan & OpenStates)

- `src/lib/ingest/state.ts` — shared pure helpers for state-level adapters:
  `stateCodeFromOpenStatesJurisdiction()` (OCD jurisdiction id → 2-letter code)
  and LegiScan `BillStatus` → instrument status mapping.
- `src/lib/ingest/openstates.ts` — `mapOpenStatesBills()` pure mapper
  (OpenStates v3 bills JSON → `RawInstrument[]`, derives the state code from
  the OCD jurisdiction id, skips foreign/malformed bills) plus
  `openStatesAdapter` (fetches `https://v3.openstates.org/bills` with the
  `X-API-KEY` header from `OPEN_STATES_API_KEY`; fails closed when unset).
- `POST /api/ingest/openstates` — ADMIN-only trigger. `jurisdiction` is
  **required** (400 without it; there is no silent `nc` default). Optional
  `session` and `limit` (default 50, capped 100 — one page per request).
- `src/lib/ingest/legiscan.ts` — `mapLegiScanMasterList()` pure mapper
  (LegiScan `getMasterList` JSON → `RawInstrument[]`, handles the numeric-key
  `masterlist` plus the special `session` key and string/number `status`) plus
  `mapLegiScanMasterListBatches()`, a generator yielding `INGEST_CHUNK_SIZE`
  batches so a full-session dump is never copied into a second full array, and
  `legiScanAdapter` (fetches
  `https://api.legiscan.com/?op=getMasterList` using `LEGISCAN_API_KEY`, which
  it requires — it fails closed when unset).
- `POST /api/ingest/legiscan` — ADMIN-only trigger. Query params `id` (session
  id, preferred) or `state` (two-letter abbreviation). `limit` is an explicit
  opt-in cap for admin testing; **omitted, the whole session is ingested**
  because `getMasterList` is a full session dump.
- Tests: table-driven mappers for both adapters, shared helper tests, batch
  generator coverage, and route authz (401/403/ADMIN/502/params) for both
  triggers.

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
- `src/lib/queries.ts` — `getHeatmapSummaries()` aggregates per-jurisdiction metrics (`relevantCount`, `pendingCount`, `issueTagCount`, `cellNoteCount`) plus a shared `totalIssueTags` (all seeded tags). The relevant/pending/note counts use Prisma `groupBy`; the distinct-issue-tag count is a single SQL `GROUP BY` over `instrument_issue_tags` joined to `instruments`, so the link table is never loaded row-by-row into memory. No schema migration is involved. The tooltip renders "X of N" from `totalIssueTags` rather than a hardcoded 8.
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

1. Public heatmap/matrix view for anonymous users â€” **done**: both pages render
   signed out with a read-only note; editor chrome requires a session.
2. Extend DB-backed integration tests to the write paths (cell notes, triage
   `PATCH`) using the `TEST_DATABASE_URL` gate that is now in place. â€” **done**:
   both write paths have `*.integration.test.ts` coverage, including re-ingest
   preserving editor triage.

See `docs/ORCHESTRATOR.md` for how to run that work.
