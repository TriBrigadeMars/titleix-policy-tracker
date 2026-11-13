# Task 005 — API skeleton with OpenAPI

> Executor: flash model · Reviewer: orchestrator · Phase: 0
> Depends on: 001 (Rust scaffold), 004 (migrations)

## Context
`crates/api` is the Axum HTTP service. The OpenAPI document is the contract
between web and api (PLAN.md §7) — this task stands up the skeleton and
tooling so later endpoint tasks only add routes.

## Scope
In `crates/api/`:
- `src/main.rs` — binary entry: load config, init tracing, run migrations,
  bind server
- `src/config.rs` — `Config { database_url: String, port: u16 }` from env
  (`DATABASE_URL` required; `PORT` default `3001`); fail fast with a clear
  error if `DATABASE_URL` is missing
- `src/routes/mod.rs` — router assembly
- `src/routes/health.rs` — `GET /health` → `200 {"status":"ok"}` (no db touch)
- `src/openapi.rs` — `utoipa` `OpenApi` derive registering the health route;
  serve spec at `GET /openapi.json` and Swagger UI at `GET /docs`
- Middleware: `tower-http` `TraceLayer`; CORS layer allowing
  `http://localhost:3000` (read allowed origin from env `WEB_ORIGIN` with
  that default)
- Graceful shutdown on SIGTERM/SIGINT

New dependencies (approved for this task): `utoipa`, `utoipa-swagger-ui`,
`tower-http` (trace, cors features).

## Acceptance criteria
1. `cargo run -p titleix-api` with `DATABASE_URL` set starts on `:3001`;
   `curl localhost:3001/health` → `{"status":"ok"}`;
   `curl localhost:3001/openapi.json` returns valid OpenAPI 3.x JSON
   containing `/health`; `/docs` renders Swagger UI
2. Missing `DATABASE_URL` → process exits non-zero with a clear stderr message
3. Integration test `crates/api/tests/health.rs`: spawn app on an ephemeral
   port, assert `/health` 200 + JSON body, assert `/openapi.json` parses and
   lists `/health`
4. `cargo clippy --workspace --all-targets -- -D warnings` and
   `cargo test --workspace` pass

## Constraints
- No endpoints beyond `/health`, `/openapi.json`, `/docs`
- No auth middleware yet (Phase 4)
- Handlers return `axum::Json`; errors via a single `ApiError` type in
  `src/error.rs` implementing `IntoResponse` (500 + `{ "error": "internal" }`
  for now)
