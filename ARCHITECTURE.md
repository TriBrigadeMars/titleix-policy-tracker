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
4. Public users view heatmap (50-state overview) and comparison matrix

## Write Path

Cell notes are the first, and currently the only, mutation in the app.

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
- Note bodies are capped at 10,000 characters at the schema layer, since
  `@db.Text` is unbounded in Postgres.

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

There is no database-backed integration test yet, and CI does not apply the
schema, so nothing currently verifies that the schema applies to a real
Postgres.

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

