# Title IX Policy Tracker

Track proposed and passed laws impacting Title IX across the United States.

## Overview

A legislative/regulatory impact tracker for researchers, advocates, and journalists. Compare proposed or recently passed laws, regulations, and policies at the state and federal level that can impact Title IX.

## Quick Start

Requires **Node 22** (see `.nvmrc`) and **PostgreSQL 16** (the version used in CI).
Ingest API keys (`CONGRESS_GOV_API_KEY`, `OPEN_STATES_API_KEY`, `LEGISCAN_API_KEY`)
are optional and only needed to run the admin ingest triggers.

```powershell
# Clone and enter the repository (all commands below assume this directory)
git clone https://github.com/TriBrigadeMars/titleix-policy-tracker.git
Set-Location .\titleix-policy-tracker

# Install dependencies from the lockfile
npm ci

# Set up environment
Copy-Item .env.example .env
# Edit .env with your database URL and Google OAuth credentials.

# Generate Prisma client and run migrations
npm run db:generate
npm run db:migrate

# Seed jurisdictions and issue tags
npm run db:seed

# Start dev server
npm run dev
```

If a later command reports that it cannot find `package.json`, you are not in the
repository root. Verify with:

```powershell
Test-Path .\package.json
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run database migrations |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:seed` | Seed jurisdictions and issue tags |
| `npm test` | Run the Vitest suite |

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for domain model, design decisions, and data flow.

## Status

Completed:

- Signed-in comparison matrix with cell notes (read + write), anonymously readable at `/`
- Editor triage and instrument notes
- 50-state heatmap, anonymously readable at `/heatmap`
- Admin user-role management
- Ingest pipeline: Congress.gov federal bills plus LegiScan and OpenStates state bills, behind admin-only trigger routes that upsert on `(jurisdictionId, type, identifier)` and refresh source-owned lifecycle status on every run

Remaining:

- Typed, source-specific ingest contracts and batch/iterable persistence
- Broader Postgres-backed integration tests for the auth guards (mocked today)

## Status and contributing

- [docs/PROGRESS.md](./docs/PROGRESS.md) — what has shipped and what has not
- [docs/ORCHESTRATOR.md](./docs/ORCHESTRATOR.md) — frontier orchestrator prompt, thermo-nuclear quality bar, and the required flash subagent template

This project uses an orchestrator + flash worker model. The orchestrator owns design and review. Flash workers only get fully specified, repetitive tasks.
