# Title IX Policy Tracker

Track proposed and passed laws impacting Title IX across the United States.

## Overview

A legislative/regulatory impact tracker for researchers, advocates, and journalists. Compare proposed or recently passed laws, regulations, and policies at the state and federal level that can impact Title IX.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your database URL and Google OAuth credentials.
# Ingest API keys (CONGRESS_GOV_API_KEY, OPEN_STATES_API_KEY, LEGISCAN_API_KEY)
# are optional and only needed to run the admin ingest triggers.

# Generate Prisma client and run migrations
npm run db:generate
npm run db:migrate

# Seed jurisdictions and issue tags
npm run db:seed

# Start dev server
npm run dev
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

- Signed-in comparison matrix with cell notes (read + write)
- Editor triage and instrument notes
- 50-state heatmap
- Admin user-role management
- Ingest pipeline: Congress.gov federal bills plus LegiScan and OpenStates state bills, behind admin-only trigger routes that upsert on `(jurisdictionId, type, identifier)`

Remaining:

- Public (anonymous) heatmap/matrix view
- Broader Postgres-backed integration tests for the write paths (cell notes, triage `PATCH`)

## Status and contributing

- [docs/PROGRESS.md](./docs/PROGRESS.md) — what has shipped and what has not
- [docs/ORCHESTRATOR.md](./docs/ORCHESTRATOR.md) — frontier orchestrator prompt, thermo-nuclear quality bar, and the required flash subagent template

This project uses an orchestrator + flash worker model. The orchestrator owns design and review. Flash workers only get fully specified, repetitive tasks.
