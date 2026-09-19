# Optional remaining work

Snapshot after **#17** merged to `main` (`35589fd4`, 2026-09-19). The documented MVP is in: comparison matrix, cell notes, triage, heatmap, admin roles, three ingest adapters, public read of `/` and `/heatmap`, and Postgres-backed ingest + cell-note + triage `PATCH` tests.

Nothing below is required to run or ship that MVP. These are extras this orchestrator session deliberately did not build.

## Features

| Item | Why it was skipped | Notes if you pick it up |
|------|--------------------|-------------------------|
| Extra instrument types (`GUIDANCE`, `EXECUTIVE_ORDER`, `COURT_ORDER`) | Schema only has `BILL` / `STATUTE` / `REGULATION`. Needs an explicit Prisma migration and UI/filter updates. | Do not sneak types in without a migration. |
| Public JSON GET APIs | Anonymous pages load via RSC + `src/lib/queries.ts`. List APIs still 401 without a session cookie. | Only add if a non-RSC client needs the data. Keep writes behind `auth-guards`. |
| Richer signed-out marketing | Public polish added `PublicReadOnlyNote` and a header **Sign in** button only. | Copy/branding, not auth. |
| Playwright / browser E2E | Out of scope for the write-path test slice. | Highest value: signed-out `/` and `/heatmap`; `/triage` redirect; EDITOR cell-note write. |
| Edge `auth()` in middleware | Cookie-presence only by design. Real gates are `(protected)/layout.tsx` and `src/lib/auth-guards.ts`. | Do not call `auth()` on the Edge. |

## Tests

| Item | Current state | Notes |
|------|---------------|--------|
| Auth-guard tests against real Postgres | Unit tests mock Prisma/`auth`. | 401/403 paths are covered with mocks; no DB round-trip for `requireUser` / `requireRole`. |
| Instrument-note write-path integration tests | `POST`/`DELETE /api/instrument-notes` have mocked unit tests only. | Cell notes and triage `PATCH` have `*.integration.test.ts`. Mirror that pattern (`TEST_DATABASE_URL`, `RUN_ID`, mock `auth` only). |
| Local execution of integration tests | Implementer worktrees had no Docker/`TEST_DATABASE_URL`. Suites skip locally; **CI ran them** on #17. | Set `TEST_DATABASE_URL` to a migrated Postgres to run `src/lib/ingest/index.integration.test.ts`, `src/app/api/cell-notes/route.integration.test.ts`, and `src/app/api/instruments/[id]/route.integration.test.ts`. |
| Whole-ingest single-transaction rollback | Phase 3 leftovers relaxed the ingest integration test to **chunk-level** rollback (`INGEST_CHUNK_SIZE=50`). A later chunk can fail after earlier chunks commit. | Retry is idempotent on `(jurisdictionId, type, identifier)`. Do not wrap all chunks in one giant transaction. |

## Docs / hygiene (not product)

| Item | Notes |
|------|--------|
| `README.md` status | Still lists public view and write-path integration tests as remaining. Both shipped in #17. |
| `docs/PROGRESS.md` | Some body text is stale (`(protected)/page.tsx` / heatmap paths, “cell notes are the only mutation”). The “what is not done” table and suggested-next-slice were patched on the stack. |
| Phase 3 commit subject BOM | `9eba07c4` subject starts with a UTF-8 BOM (`fix(phase-3):…`). Already on `main` via merge commit. Rewrite history only if you really care. |
| GitHub Actions annotations on #17 | Node 20 deprecation on `actions/checkout@v4` / `setup-node@v4`; `ubuntu-latest` image migration notice. Unrelated to app code. |

## Intentionally not in this list

- Merging #17 — done.
- Public anonymous matrix/heatmap — done (`isPublicPath`, exact `/`, `/heatmap` prefix).
- Write-path DB tests for cell notes and instrument triage `PATCH`, including ingest-must-not-clobber — done (skip without `TEST_DATABASE_URL`; CI sets it).
- Thermo-nuclear Phases 1–4 (triage encoding, ingest reliability, docs/dedup) — done on `main`.
