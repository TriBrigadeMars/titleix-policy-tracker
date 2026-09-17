# Title IX Policy Tracker — Development Plan

> Status: Draft v1 · 2026-09-17 · Author: orchestrator session (Kimi K3) with product owner

---

## 1. App Description

**Title IX Policy Tracker** is a legislative and regulatory monitoring service that
tracks new and proposed bills, legislation, regulations, and agency guidance
pertaining to **Title IX** at the **federal and state** level, as they apply to
**K-12 schools and universities**.

The system automatically ingests items from public sources (Congress.gov, the
Federal Register, and state legislature APIs), queues them for admin review, and
presents them in a searchable, filterable web app. Compliance officers subscribe
to alerts scoped to their jurisdiction and institution type.

### What it is not (v1)
- Not a case-management tool (no internal incident/case tracking).
- Not legal advice; summaries are informational and link to primary sources.
- Not a document archive of institutional policies.

---

## 2. Intended Userbase

**Primary: school compliance officers and administrators (K-12 and higher ed).**

| Persona | Needs |
|---|---|
| University Title IX coordinator | Federal regs + their state's bills; alerts before rules take effect |
| K-12 district compliance officer | State legislature activity; plain-language summaries |
| System/multi-campus administrator | Multi-state view; digest emails; export for board reports |

Secondary: advocacy organizations, researchers, journalists (read-only public access).

---

## 3. Feature Set

### MVP (v1)
1. **Ingestion pipeline** — scheduled workers pull from:
   - Congress.gov API (federal bills)
   - Federal Register API (proposed/final rules, notices from ED/OCR)
   - OpenStates API (state bills; fallback: per-state scrapers for gaps)
   - Manual: ED "Dear Colleague" letters / guidance (admin-entered, v1)
2. **Admin review queue** — every ingested item lands as `pending`; an admin
   approves, rejects, edits tags/summary, then publishes.
3. **Public web app**
   - Feed of published items, newest first
   - Item detail: status timeline, sponsor(s), source links, summary, tags
   - Filters: jurisdiction (federal / state), state, level (K-12 / higher ed /
     both), item type (bill / rule / guidance), status, date range
   - Full-text search over titles + summaries
4. **Accounts & alerts**
   - Email/password auth
   - Saved filters ("subscriptions"): e.g. "Texas + K-12 + bills"
   - Email alerts: instant or daily/weekly digest
5. **Admin dashboard** — review queue, manual entry, tag management, ingestion
   health (last run, items fetched, errors).

### Post-MVP (v2+)
- OCR guidance auto-ingestion; Federal Register comment-period tracking
- CSV/PDF export for board reports
- Bill-text diffing between versions; "related items" linking
- Public API (read-only); RSS per filter
- Organization accounts (district/university teams, shared subscriptions)

---

## 4. Tech Stack (recommended)

Priorities from product owner: **stability and speed**; Rust preferred where it
fits naturally.

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | **Next.js 15 (React + TypeScript)**, Tailwind | Fast iteration, huge ecosystem, flash models generate it reliably |
| Backend API | **Rust — Axum + SQLx** | Stability/speed per owner priority; strong typing catches flash-model errors at compile time |
| Ingestion workers | **Rust** (same workspace, separate binary), `tokio` + `reqwest` + `cron` | Polled, rate-limited API clients; shares models with API via a `core` crate |
| Database | **PostgreSQL 16** (Neon or self-hosted) | JSONB for raw source payloads, full-text search built in |
| Auth | **Rust-side session auth** (email/password, verified emails) — final call in Phase 0 | Keep simple; no OAuth in v1 |
| Email | Resend / Postmark | Transactional alerts + digests |
| Hosting | Vercel (web) + Fly.io or Render (api + worker) + Neon (db) | Low cost, low ops |
| CI | GitHub Actions: fmt, clippy, `cargo test`, `tsc`, Playwright smoke | Quality gate for flash-model output |

**Key architectural decision:** a Rust workspace with three crates —
`core` (domain models, db), `api` (Axum), `worker` (ingestion) — so the data
model has exactly one definition.

---

## 5. Codebase Layout

```
titleix-policy-tracker/
├── apps/
│   └── web/                  # Next.js frontend (src/ dir, per task 002)
│       └── src/
│           ├── app/          # routes: /feed, /item/[id], /alerts, /admin/*
│           ├── components/
│           └── lib/          # API client, types (generated from OpenAPI)
├── crates/
│   ├── core/                 # domain models, db queries, shared logic
│   ├── api/                  # Axum HTTP API (REST, OpenAPI via utoipa)
│   └── worker/               # ingestion scheduler + source clients
├── docs/
│   ├── PLAN.md               # this file
│   ├── DATA-MODEL.md         # schema + entity definitions
│   ├── SOURCES.md            # per-source API details, query terms, rate limits
│   └── tasks/                # numbered task specs for the flash model
├── .github/workflows/        # CI
└── README.md
```

---

## 6. Data Model (sketch — full version in DATA-MODEL.md)

- **items** — one row per tracked thing: `id, type (bill|rule|guidance),
  jurisdiction (federal|state), state, title, summary, status, introduced_at,
  source_name, source_id, source_url, raw_json, review_state
  (pending|published|rejected), created_at, updated_at`
- **item_events** — status timeline: `item_id, event_date, event_type, description`
- **tags / item_tags** — `k12`, `higher-ed`, `athletics`, `due-process`, etc.
- **users** — `id, email, password_hash, role (admin|subscriber), verified`
- **subscriptions** — `user_id, filter_json, frequency (instant|daily|weekly)`
- **alerts_sent** — dedupe log: `user_id, item_id, sent_at`
- **ingestion_runs** — `source, started_at, finished_at, fetched, inserted, error`

---

## 7. Orchestrator vs. Flash Model — Task Division

**Principle:** the orchestrator (frontier model) owns everything where a mistake
is expensive or ambiguous; the flash model executes tasks with a written spec,
a definition of done, and CI as the safety net. Rust's compiler is a major
asset here — it catches whole classes of flash-model errors before review.

### Orchestrator owns
- Product decisions, scope control, this plan
- Data model & migrations design (DATA-MODEL.md)
- API contract (OpenAPI spec) — the single source of truth between web and api
- Source integration design (SOURCES.md): endpoints, query terms, dedup keys,
  rate-limit strategy
- Task specs in `docs/tasks/NNN-slug.md`: context, files to touch, exact
  interfaces, acceptance criteria, test requirements
- Auth/security-sensitive code review (sessions, password hashing, admin gates)
- Reviewing all flash output; running CI; resolving cross-cutting conflicts

### Flash model executes (good candidates)
- Scaffold tasks: crate/app init, CI workflow, lint configs
- CRUD endpoints from the OpenAPI spec (one task per resource)
- Ingestion client per source, given SOURCES.md (one task per source)
- React components/pages from a written UI spec + API types
- Unit tests, seed data, README sections, migrations from DATA-MODEL.md
- Copy-heavy work: summaries UI, email templates

### Flash model should NOT touch (without orchestrator spec + review)
- Schema changes, auth logic, the dedup/matching algorithm, anything touching
  `raw_json` parsing rules, deployment config

### Task-spec template (every flash task)
1. **Context** — 2-3 sentences + links to PLAN/DATA-MODEL/SOURCES sections
2. **Scope** — exact files/modules to create or modify; explicit out-of-scope
3. **Interfaces** — function signatures / endpoint definitions to implement
4. **Acceptance criteria** — observable behavior + required tests
5. **Constraints** — no new dependencies without approval; must pass CI

---

## 8. Roadmap

| Phase | Deliverable | Primary executor |
|---|---|---|
| 0 | Repo scaffold: workspace, Next app, CI, DATA-MODEL.md, OpenAPI skeleton | Orchestrator designs; flash scaffolds |
| 1 | Federal ingestion: Congress.gov + Federal Register clients, review queue | Flash (per-source tasks); orchestrator reviews dedup |
| 2 | State ingestion via OpenStates; ingestion health dashboard | Flash |
| 3 | Public feed, item detail, search/filters | Flash (UI from spec) |
| 4 | Auth, subscriptions, email alerts/digests | Orchestrator specifies auth; flash implements |
| 5 | Admin dashboard polish, manual entry, launch hardening | Mixed |

---

## 9. Open Questions (resolve in Phase 0)

1. Auth: Rust-side sessions vs. Auth.js in Next — pick one before Phase 4.
2. Summaries: hand-written by admins at review time (v1 default) vs.
   LLM-assisted drafts — decide cost/quality tradeoff.
3. OpenStates coverage gaps: which priority states need fallback scrapers?
4. Alert volume: instant alerts need rate-limiting/quiet-hours policy.
