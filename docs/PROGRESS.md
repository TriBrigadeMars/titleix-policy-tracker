# Work done so far

Title IX Policy Tracker is a signed-in Next.js 15 app (App Router, Prisma/Postgres, Auth.js Google OAuth, Tailwind/shadcn) for comparing state and federal law that can affect Title IX.

Honest status: the **read/compare + cell-note write** slice is real and structurally sound. Ingest, triage, heatmap, and admin are not. Treat this as roughly **the first third of the product in ARCHITECTURE.md**, not 55-60%.

Merged through [PR #6](https://github.com/TriBrigadeMars/titleix-policy-tracker/pull/6) on `main`.

Ingest slice (Congress.gov adapter + upsert) added after PR #7.

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

### Ingest (Congress.gov)

- `src/lib/ingest/types.ts` — `RawInstrument` (source-agnostic) and `IngestAdapter` interface.
- `src/lib/ingest/congress-gov.ts` — `CongressGovAdapter` fetches federal bills from the Congress.gov v3 API and maps them to `RawInstrument[]`. The mapping is a pure function (`mapBillToRawInstrument`) tested with fixtures; the HTTP fetch is a thin layer.
- `src/lib/ingest/upsert.ts` — `upsertInstruments()` resolves jurisdiction codes to ids in one query, then upserts on `(jurisdictionId, type, identifier)` inside a `$transaction`. On update, sets machine-known fields + `lastCheckedAt`; does NOT touch `isTitleIXRelevant` or `relevanceConfidence` (editor-owned).
- `POST /api/ingest` — ADMIN-only trigger. Optional `?congress=N` query param. Requires `CONGRESS_GOV_API_KEY`.
- Status mapping is a best-effort heuristic from `latestAction.text`: "Became Public Law" / "Signed by" → PASSED, "Vetoed" → ENJOINED, "Repealed" → REPEALED, default → PROPOSED. Editors triage and correct.

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
| ~~Ingest adapters~~ | **Done:** Congress.gov federal bills. Remaining: LegiScan, OpenStates, etc. for state-level. |
| Triage UI | No way to set `isTitleIXRelevant`, confidence, or instrument issue tags. |
| Instrument notes | Model exists. No API or UI. |
| Heatmap | 50-state overview from ARCHITECTURE.md. Not started. |
| Admin | `ADMIN` equals `EDITOR` in practice. No user-role management. |
| Public heatmap vs signed-in compare | Product is sign-in-to-read. Architecture still mentions public users. |
| Integration tests | CI applies migrations but tests never hit Postgres. |
| State-level ingest | LegiScan/OpenStates adapters for state bills. Schema is ready. |
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
| Ingest types | `src/lib/ingest/types.ts` |
| Ingest upsert | `src/lib/ingest/upsert.ts` |
| Congress.gov adapter | `src/lib/ingest/congress-gov.ts` |
| Domain rules | `ARCHITECTURE.md` |

## Suggested next slice

1. ~~Ingest: one adapter interface + Congress.gov federal bills, upserting on the unique key.~~ **Done.**
2. Editor triage: mark relevance, attach issue tags, write `InstrumentNote`.
3. Heatmap that consumes the same query layer (do not fetch from the client).
4. Admin role changes.
5. Postgres integration tests for migrate + upsert ingest.
6. State-level ingest adapters (LegiScan, OpenStates) once triage exists.

See `docs/ORCHESTRATOR.md` for how to run that work.
