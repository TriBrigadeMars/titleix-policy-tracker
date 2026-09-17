# Task 003 — CI workflow (GitHub Actions)

> Executor: flash model · Reviewer: orchestrator · Phase: 0
> Depends on: 001 (Rust scaffold), 002 (web scaffold)

## Context
CI is the safety net for flash-model output (PLAN.md §7). Every PR must run
Rust checks, web checks, and a Playwright smoke test against Postgres.

## Scope
Create `.github/workflows/ci.yml` with three jobs:

### Job `rust`
- `ubuntu-latest`, stable toolchain via `dtolnay/rust-toolchain@stable`,
  `Swatinem/rust-cache@v2`
- Steps: `cargo fmt --all -- --check` →
  `cargo clippy --workspace --all-targets -- -D warnings` →
  `cargo test --workspace`
- Service container: `postgres:16` (env `POSTGRES_PASSWORD=postgres`,
  port 5432, health check `--health-cmd "pg_isready"`) so future db tests run

### Job `web`
- `ubuntu-latest`, `pnpm/action-setup`, `actions/setup-node` with
  `cache: pnpm`, `node-version: 22`
- Steps: `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm build`
  (working-directory `apps/web`)

### Job `smoke`
- Needs: `rust`, `web`
- Postgres service container (same as above)
- Steps: build and start `titleix-api` in the background, start the web app,
  install Playwright (`pnpm dlx playwright install --with-deps chromium`),
  run one Playwright test `apps/web/e2e/smoke.spec.ts`: `GET /feed` returns
  200 and contains "Policy feed"
- Add `apps/web/e2e/smoke.spec.ts` + minimal `playwright.config.ts`
  (webServer config may be omitted since CI starts servers manually)

Out of scope: deployment workflows, release automation, coverage upload.

## Acceptance criteria
1. Workflow triggers on `push` to `main` and on all PRs
2. All three jobs pass on the scaffold PR
3. Job-level `timeout-minutes` set (rust: 20, web: 15, smoke: 20)
4. Failed jobs upload useful artifacts: Playwright trace on smoke failure

## Constraints
- Pin all actions by major version tag (e.g. `actions/checkout@v4`)
- No third-party actions beyond those named above
- Secrets: none required for this task; do not add any
