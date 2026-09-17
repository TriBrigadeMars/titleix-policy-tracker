# Task 001 — Rust workspace scaffold

> Executor: flash model · Reviewer: orchestrator · Phase: 0

## Context
Title IX Policy Tracker uses a Rust workspace with three crates so the domain
model has exactly one definition. See `docs/PLAN.md` §4–5. This task creates
the workspace skeleton only — no business logic.

## Scope
Create at repo root:
- `Cargo.toml` (workspace) with members `crates/core`, `crates/api`, `crates/worker`
- `crates/core/Cargo.toml` + `crates/core/src/lib.rs` — library crate named `titleix-core`
- `crates/api/Cargo.toml` + `crates/api/src/main.rs` — binary crate named `titleix-api`; `main` prints "api: not yet implemented" and exits 0
- `crates/worker/Cargo.toml` + `crates/worker/src/main.rs` — binary crate named `titleix-worker`; same placeholder behavior
- `rustfmt.toml` — `edition = "2021"`, `max_width = 100`
- `clippy.toml` — default
- `.gitignore` — add `/target`, `*.rs.bk`, `.env`

Out of scope: any endpoints, db code, docker, CI (separate tasks).

## Interfaces
- Workspace dependencies declared once in root `[workspace.dependencies]` and
  inherited via `{ workspace = true }`:
  - `tokio` (rt-multi-thread, macros), `axum`, `sqlx` (postgres, runtime-tokio,
    uuid, chrono, json), `serde` + `serde_json`, `thiserror`, `tracing`,
    `tracing-subscriber`, `uuid` (v4, serde), `chrono` (serde)
- `crates/core` depends on: serde, serde_json, sqlx, uuid, chrono, thiserror
- `crates/api` and `crates/worker` depend on: `titleix-core` (path), tokio,
  tracing, tracing-subscriber (api also: axum; worker also: reqwest in a later
  task — do NOT add reqwest yet)

## Acceptance criteria
1. `cargo fmt --all -- --check` passes
2. `cargo clippy --workspace --all-targets -- -D warnings` passes
3. `cargo test --workspace` passes (each crate has one trivial `it_works` test)
4. `cargo run -p titleix-api` and `cargo run -p titleix-worker` print the
   placeholder message and exit 0
5. `README.md` gains a "Rust toolchain" section: `rustup` install, stable
   toolchain, the three commands above

## Constraints
- No dependencies beyond the list above without orchestrator approval
- Rust edition 2021, stable toolchain (pin via `rust-toolchain.toml`: `channel = "stable"`)
- Do not commit `Cargo.lock` changes for anything except these crates
