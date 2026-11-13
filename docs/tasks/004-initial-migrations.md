# Task 004 — Initial database migrations

> Executor: flash model · Reviewer: orchestrator · Phase: 0
> Depends on: 001 (Rust scaffold)

## Context
`docs/DATA-MODEL.md` is the binding schema. This task implements it as SQLx
migrations. The schema is orchestrator-owned: implement it **exactly**; any
perceived problem is raised in the PR description, not "fixed" silently.

## Scope
Create in `crates/core/`:
- `migrations/0001_extensions.up.sql` / `.down.sql` — `pgcrypto`, `citext`
- `migrations/0002_enums.up.sql` / `.down.sql` — the five enums
- `migrations/0003_items.up.sql` / `.down.sql` — `items` incl. generated
  `search_tsv`, all constraints and indexes per DATA-MODEL.md
- `migrations/0004_item_events.up.sql` / `.down.sql`
- `migrations/0005_tags.up.sql` / `.down.sql` — `tags`, `item_tags`, plus
  idempotent seed of the ten tags listed in DATA-MODEL.md
  (`ON CONFLICT (slug) DO NOTHING`)
- `migrations/0006_users_sessions.up.sql` / `.down.sql` — `users`, `sessions`
- `migrations/0007_subscriptions_alerts.up.sql` / `.down.sql` —
  `subscriptions`, `alerts_sent`
- `migrations/0008_ingestion_runs.up.sql` / `.down.sql`
- `migrations/0009_updated_at_trigger.up.sql` / `.down.sql` —
  `set_updated_at()` function + triggers on `items`, `users`, `subscriptions`
- `src/db.rs` — `pub async fn migrate(pool: &sqlx::PgPool) -> Result<(), sqlx::Error>`
  wrapping `sqlx::migrate!()`
- `src/lib.rs` — `pub mod db;`

## Acceptance criteria
1. Against a fresh Postgres 16: `sqlx migrate run` succeeds; running it again
   is a no-op; `sqlx migrate revert` rolls back the last migration cleanly
2. Integration test `crates/core/tests/migrations.rs` (uses
   `DATABASE_URL` from env): migrate → insert one `items` row with
   `source_name='manual'` → verify `search_tsv` is populated → verify a second
   insert with the same `(source_name, source_id)` violates the unique
   constraint → verify `updated_at` changes on UPDATE
3. `cargo test -p titleix-core` passes (CI provides Postgres)
4. Seed tags present exactly once after two consecutive migrate runs

## Constraints
- Schema must match DATA-MODEL.md exactly: names, types, constraints, indexes
- No ORM, no query-builder codegen, no `sqlx-cli` as a dependency (dev-tool only)
- Raw SQL migrations; no migration frameworks beyond `sqlx::migrate!`
