# Architecture

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript (strict)
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Auth:** NextAuth.js v5 (Auth.js) with Google OAuth
- **Styling:** Tailwind CSS + shadcn/ui

## Domain Model

### Jurisdictions

- `US` (federal) + all 50 states + `DC` (seeded as `STATE`)
- Each has a code, name, and level (`FEDERAL` | `STATE`)

### Issue Tags (Matrix Rows)

1. Coverage — sex, sexual orientation, gender identity
2. Athletics eligibility
3. Facilities & housing
4. Harassment standard
5. Grievance / due process
6. Pregnancy & parental status
7. Religious and statutory exemptions
8. Reporting duties & retaliation

### Instruments

Legal/policy items tracked per jurisdiction:

- **Types:** `BILL`, `STATUTE`, `REGULATION` (enum — adding values requires a migration)
- **Status:** `PROPOSED`, `PASSED`, `EFFECTIVE`, `ENJOINED`, `REPEALED`
- **Fields:** identifier, title, status, dates, source URL, last checked, Title IX relevance flag + confidence
- **Unique keys:** `(jurisdictionId, type, identifier)` is the identity ingest upserts on.
  `(source, sourceId)` is a second, optional unique key for adapters that have a
  stable upstream id (Congress.gov, LegiScan, OpenStates all set it). It is
  nullable, so rows without a source id are unaffected.
- **Triage encoding:** `TriageStatus` (`UNREVIEWED` | `RELEVANT` | `NOT_RELEVANT`)
  is the editor-owned relevance encoding, centralized in `src/lib/triage.ts`
  (`triageStatus()` / `triageWhere()`). `isTitleIXRelevant` remains on the row
  because the matrix query filters on it directly. The two are kept in sync by
  the triage endpoint, and ingest must not overwrite triage fields or `status`
  on update.

### Notes

- **InstrumentNote:** per-instrument editor comments (triage, verification).
  `authorId` is optional and `onDelete: SetNull`, so deleting a user keeps the
  note rather than cascading it away.
- **CellNote:** per-cell (jurisdiction × issue tag) comparison notes — the human-written content shown in the matrix. `authorId` is also `onDelete: SetNull`.

### Users & Roles

| Role | Permissions |
|------|-------------|
| `READER` | Sign in required, read-only |
| `EDITOR` | Tag relevance, write notes |
| `ADMIN` | Manage users, full access |

New users default to `READER`.

## Key Design Decisions

- **Public read + signed-in editors:** Anonymous users cannot read; anyone with a Google account can sign in and read. Editors are promoted manually.
- **Machine tracking, human analysis:** APIs fetch bill/status data. Only editors (humans) tag Title IX relevance and write comparison notes.
- **Extensible schema, not extensible enum:** `InstrumentType` is a Prisma enum. Adding new types requires a migration. The schema is designed to support future types (guidance, executive orders, court orders) but they must be added explicitly.
- **Matrix UX:** Rows = issue tags, columns = user-selected jurisdictions (2–8), cells = current rule + pending instruments + source citations.

## Data Flow

1. Ingest adapters (Congress.gov, LegiScan, OpenStates, etc.) fetch instrument data
2. Frontier/human editors triage new instruments for Title IX relevance
3. Editors write cell notes comparing jurisdictions on each issue
4. Anyone — signed in or not — reads the comparison matrix and the 50-state
   heatmap; write routes stay behind a session

The heatmap exists: `(public)/heatmap/page.tsx` renders
`src/components/state-heatmap.tsx` from `getHeatmapSummaries()` in
`src/lib/queries.ts`, which aggregates per-jurisdiction counts
(`relevantCount`, `pendingCount`, `issueTagCount`, `cellNoteCount`) plus a
shared `totalIssueTags` with parallel Prisma queries and in-memory joins — no
raw SQL, no schema migration. The tooltip renders "X of N" from
`totalIssueTags` rather than a hardcoded 8.

Comparison reads are server-loaded. Selected jurisdictions live in the `j`
search param as codes (`/?j=US,CA,TX`). `(public)/page.tsx` resolves those
codes, then `src/lib/queries.ts` loads issue tags, Title IX-relevant
instruments, and cell notes in parallel. The client selector only updates the
URL; it does not fetch.

List APIs (`GET /api/instruments`, `GET /api/cell-notes`) use the same query
helpers. They require `jurisdictionIds` (max 8) and never dump the full table.

## Write Path

Cell notes are the first mutation.

- `PUT /api/cell-notes` upserts the note for a `(jurisdiction, issue tag)` pair,
  which `CellNote` already treats as unique. There is deliberately no separate
  create and update endpoint.
- `DELETE /api/cell-notes?id=...` removes a single note.
- Both require `EDITOR`, enforced with `requireRole()`. Reads need only
  `requireUser()`.
- `authorId` always comes from the session. The request body is parsed with the
  strict zod schema in `src/lib/validation.ts`, so a body cannot set the author
  or smuggle in any other column.
- Editing a note does **not** reassign the author: the cell keeps crediting
  whoever first wrote it, and `updatedAt` is what signals a later revision. If
  that proves insufficient, an `updatedById` column is the fix, and it would
  need the first Prisma migration.
- Note bodies are capped at 10,000 characters in both zod and the database
  (`@db.VarChar(10000)`). Instruments are unique on
  `(jurisdictionId, type, identifier)` so ingest can upsert instead of
  inventing dedup branches.

## Ingest Path

Machine ingest is the second mutation surface. It does not touch editor-owned
fields (`isTitleIXRelevant`, `relevanceConfidence`); it only writes
machine-known fields and `lastCheckedAt`.

- **Adapter interface + upsert** (`src/lib/ingest/index.ts`):
  `IngestAdapter.fetch()` returns `RawInstrument[]` — a source-agnostic shape.
  No database access lives in the adapter. `upsertInstruments()` resolves
  jurisdiction codes to ids in one query, then upserts on
  `(jurisdictionId, type, identifier)`. On update, sets machine fields +
  `lastCheckedAt`; does not touch `isTitleIXRelevant`, `relevanceConfidence`,
  `triageStatus`, or `status`.
- **Chunked writes:** rows are written in `INGEST_CHUNK_SIZE` (50) row
  `$transaction`s, one transaction per chunk. A chunk that throws leaves earlier
  chunks committed and the error is rethrown, never swallowed. Retrying the same
  ingest is safe because the write is idempotent (unique key + machine-only
  update path), so a retry converges instead of duplicating rows.
- **Fetch timeout:** adapters abort upstream calls after `FETCH_TIMEOUT_MS`
  (10s) via `AbortSignal.timeout()`, so a hung API cannot stall an ingest.
- **Shared route plumbing** (`src/lib/ingest/route-helpers.ts`):
  `INGEST_GENERIC_ERROR` and `paramInt()` (clamp + truncate, fallback on
  non-finite) are shared by all three trigger routes. The routes keep their own
  limits; the handlers are deliberately not merged.
- **Congress.gov adapter** (`src/lib/ingest/congress.ts`): fetches federal
  bills from the Congress.gov v3 API, maps each bill to `RawInstrument` via a
  pure `mapCongressBills` function. The identifier is
  `${type}-${number}-${congress}` (e.g. `HR-1234-119`). Status defaults to
  `PROPOSED`; editors triage. Requires `CONGRESS_GOV_API_KEY`.
- **Trigger** (`POST /api/ingest/congress`): ADMIN-only. Optional `?congress=N`.
- **State adapters** (`src/lib/ingest/openstates.ts`, `src/lib/ingest/legiscan.ts`):
  fetch state bills from OpenStates v3 and LegiScan, deriving the two-letter
  jurisdiction code from the source. Shared helpers (state-code derivation and
  LegiScan status mapping) live in `src/lib/ingest/state.ts`.
  - `POST /api/ingest/openstates` — ADMIN-only, keyed by `OPEN_STATES_API_KEY`.
    `jurisdiction` is **required** (400 without it); there is no silent `nc`
    default. Optional `session` and `limit` (default 50, capped 100 — one page
    per request).
  - `POST /api/ingest/legiscan` — ADMIN-only, keyed by `LEGISCAN_API_KEY`.
    `id` (session id) takes precedence over `state`. `limit` is opt-in for admin
    testing; omitted, it ingests the entire session because `getMasterList` is a
    full session dump.
  - All three adapters **fail closed** when their API key is missing rather than
    issuing an unkeyed request.
- **Error contract:** upstream failures return `502` with a generic body
  (`Ingest failed. Check server logs for details.`). Real errors — which can
  carry API keys or internal URLs — are logged server-side only.


The UI only renders edit affordances when the server says the viewer is an
`EDITOR` (`canEdit` in `(public)/page.tsx`). That is a display concern, not a
security boundary; the API guard is what authorizes the write.

## Testing

`npm test` runs Vitest over `src/**/*.test.ts`. Coverage is concentrated on the
two places where a regression would otherwise be silent:

- `src/lib/roles.test.ts` - the `READER < EDITOR < ADMIN` hierarchy, including
  failing closed for an unrecognized role.
- `src/lib/validation.test.ts` - the strict cell note schema, including the
  length boundary and rejection of unknown fields.
- `src/app/api/cell-notes/route.test.ts` - the 401/403 boundary and the upsert
  arguments, with `auth` and Prisma mocked. Asserts that `authorId` comes from
  the session and is never taken from the request.

`src/lib/ingest/index.integration.test.ts` is the first DB-backed test: it runs
`upsertInstruments` against a real Postgres (gated on `TEST_DATABASE_URL`, skips
when unset) covering create-on-first-sight, in-place update, editor-field
preservation, unknown-jurisdiction skip, chunked transactions, and the
Congress.gov mapper→DB path end to end. Everything else — auth guards,
cell-note writes, the triage `PATCH` — still relies on mocked Prisma. CI runs
`prisma migrate deploy`
against the workflow Postgres service before lint/typecheck/build/test, so the
checked-in migration must apply.

## Security

- OAuth via Google (NextAuth.js)
- Sessions are stored in the database via the Prisma adapter, so role changes
  take effect immediately (no stale JWT to wait out).
- `security-review` agent audit required after any auth-related PR

### Authorization layers

Access is enforced in three places, in order:

| Layer | File | Scope |
|-------|------|-------|
| Edge middleware | `src/middleware.ts` | Fast-path only: redirects to `/sign-in` (or returns 401 JSON for `/api/*`) when no session cookie is present. Does **not** validate the session. `/`, `/heatmap`, `/sign-in`, and `/api/auth` are allowed without a cookie — `/` matches exactly, so it never opens `/triage` or `/admin`. |
| Route-group layout | `src/app/(protected)/layout.tsx` | Authoritative page gate. Calls `auth()` and redirects unauthenticated users. |
| API guards | `src/lib/auth-guards.ts` | Authoritative API gate. `requireUser()` / `requireRole()` return a typed result the handler can return directly. |

The middleware deliberately does **not** call `auth()`: sessions live in the
database and the edge runtime cannot reach it. Treat it as a UX optimization,
never as the security boundary.

Roles are defined once in `src/lib/roles.ts` (a mirror of the Prisma `UserRole`
enum, kept separate so `tsc --noEmit` works before `prisma generate` runs) and
compared with `hasRole()`, which implements the `READER < EDITOR < ADMIN`
hierarchy.

