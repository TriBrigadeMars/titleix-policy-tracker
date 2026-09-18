# Work done so far

Title IX Policy Tracker is a signed-in Next.js 15 app (App Router, Prisma/Postgres, Auth.js Google OAuth, Tailwind/shadcn) for comparing state and federal law that can affect Title IX.

Honest status: the **read/compare + cell-note write** slice is real and structurally sound. Ingest, triage, heatmap, and admin are not. Treat this as roughly **the first third of the product in ARCHITECTURE.md**, not 55-60%.

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

## What is not done

| Gap | Notes |
|-----|--------|
| Heatmap | 50-state overview from ARCHITECTURE.md. Not started. |
| Admin | `ADMIN` equals `EDITOR` in practice. No user-role management. |
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
- Query layer: `instrumentTriageWhere`, `getInstrumentsForTriage`, and `getInstrumentById` in `src/lib/queries.ts`.
- Tests: route unit tests for `PATCH /api/instruments/[id]` and `POST`/`DELETE /api/instrument-notes` covering 401/403/400/404, Zod schema validation tests, and query where builder tests.

## Suggested next slice

1. Heatmap that consumes the same query layer (50-state overview, do not fetch from the client).
2. Admin role changes (promote/demote users, ADMIN only).
3. Postgres integration tests for migrate + upsert ingest.
4. More ingest adapters (LegiScan, OpenStates) — now just implement
   `IngestAdapter` and add a route; the upsert path is reusable.

See `docs/ORCHESTRATOR.md` for how to run that work.
