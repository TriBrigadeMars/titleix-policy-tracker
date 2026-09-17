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

## Security

- OAuth via Google (NextAuth.js)
- Role-based access enforced in API routes and middleware
- `security-review` agent audit required after any auth-related PR
