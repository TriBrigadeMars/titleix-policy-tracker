# Task 006 — Local dev environment (docker-compose + quickstart)

> Executor: flash model · Reviewer: orchestrator · Phase: 0
> Depends on: 001, 002, 004, 005

## Context
A new contributor (or a fresh flash-model session) must go from clone to
running stack in under 10 minutes using only the README.

## Scope
Create at repo root:
- `docker-compose.yml`:
  - `db`: `postgres:16-alpine`, env `POSTGRES_USER=titleix`,
    `POSTGRES_PASSWORD=titleix`, `POSTGRES_DB=titleix`, port `5432:5432`,
    named volume `pgdata`, healthcheck `pg_isready -U titleix`
  - No api/web services — those run locally via cargo/pnpm
- `.env.example` at root:
  - `DATABASE_URL=postgres://titleix:titleix@localhost:5432/titleix`
  - `PORT=3001`
  - `WEB_ORIGIN=http://localhost:3000`
  - `CONGRESS_GOV_API_KEY=` (empty, with comment "required for worker")
  - `OPENSTATES_API_KEY=` (empty, same)
- Rewrite `README.md` (keep the `# titleix-policy-tracker` title) with:
  1. One-paragraph project description (from PLAN.md §1)
  2. Prerequisites: Rust stable, Node 22 + pnpm, Docker
  3. Quickstart: `cp .env.example .env` → `docker compose up -d` →
     `cargo run -p titleix-api` (migrations run automatically) →
     `cd apps/web && pnpm install && pnpm dev` → open
     `http://localhost:3000/feed`
  4. "Verifying" section: `curl localhost:3001/health` expected output
  5. Links to `docs/PLAN.md`, `docs/DATA-MODEL.md`, `docs/SOURCES.md`,
     `docs/tasks/`

## Acceptance criteria
1. `docker compose config` validates
2. Fresh-clone walkthrough: following the README exactly results in a running
   api (health 200) and web app (feed page renders)
3. `docker compose down -v` then `up -d` → api re-migrates cleanly on next start
4. README contains no steps beyond those needed (verified by doing the
   walkthrough in a clean temp clone)

## Constraints
- Compose file: no `version:` key (obsolete), no exposed ports besides 5432
- Do not commit a real `.env`; only `.env.example`
- No Makefiles/justfiles/task runners — README commands must be copy-pasteable
  on Windows (PowerShell), macOS, and Linux
