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

- `US` (federal) + all 50 states
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

### Notes

- **InstrumentNote:** per-instrument editor comments (triage, verification)
- **CellNote:** per-cell (jurisdiction × issue tag) comparison notes — the human-written content shown in the matrix

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
4. Signed-in users view the comparison matrix (heatmap is not built yet)

Comparison reads are server-loaded. Selected jurisdictions live in the `j`
search param as codes (`/?j=US,CA,TX`). `(protected)/page.tsx` resolves those
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

- **Adapter interface** (`src/lib/ingest/types.ts`): `IngestAdapter.fetch()`
  returns `RawInstrument[]` — a source-agnostic shape. No database access lives
  in the adapter.
- **Congress.gov adapter** (`src/lib/ingest/congress-gov.ts`): fetches federal
  bills from the Congress.gov v3 API, maps each bill to `RawInstrument` via a
  pure `mapBillToRawInstrument` function. The identifier is
  `${congress}-${type}-${number}` (e.g. `119-HR-1234`). Status is inferred from
  `latestAction.text` as a best-effort heuristic; editors triage.
- **Upsert** (`src/lib/ingest/upsert.ts`): resolves jurisdiction codes to ids
  in one query, then upserts on `(jurisdictionId, type, identifier)` inside a
  `$transaction`. On update, sets machine fields + `lastCheckedAt`; does not
  touch `isTitleIXRelevant` or `relevanceConfidence`.
- **Trigger** (`POST /api/ingest`): ADMIN-only. Optional `?congress=N`. Requires
  `CONGRESS_GOV_API_KEY` env var.

The UI only renders edit affordances when the server says the viewer is an
`EDITOR` (`canEdit` in `(protected)/page.tsx`). That is a display concern, not a
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

There is no database-backed integration test yet. CI runs `prisma migrate deploy`
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
| Edge middleware | `src/middleware.ts` | Fast-path only: redirects to `/sign-in` (or returns 401 JSON for `/api/*`) when no session cookie is present. Does **not** validate the session. |
| Route-group layout | `src/app/(protected)/layout.tsx` | Authoritative page gate. Calls `auth()` and redirects unauthenticated users. |
| API guards | `src/lib/auth-guards.ts` | Authoritative API gate. `requireUser()` / `requireRole()` return a typed result the handler can return directly. |

The middleware deliberately does **not** call `auth()`: sessions live in the
database and the edge runtime cannot reach it. Treat it as a UX optimization,
never as the security boundary.

Roles are defined once in `src/lib/roles.ts` (a mirror of the Prisma `UserRole`
enum, kept separate so `tsc --noEmit` works before `prisma generate` runs) and
compared with `hasRole()`, which implements the `READER < EDITOR < ADMIN`
hierarchy.

