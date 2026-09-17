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
# Edit .env with your database URL and Google OAuth credentials

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

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for domain model, design decisions, and data flow.

## Contributing

This project uses an orchestrator + flash worker model. See the architecture doc for the PR stack and review cadence.
