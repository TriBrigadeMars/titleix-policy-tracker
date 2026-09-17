# Data Model — Title IX Policy Tracker

> Status: v1 · 2026-09-17 · Owner: orchestrator. Flash-model tasks must not
> deviate from this schema without an updated version of this document.

Database: **PostgreSQL 16**. Migrations: SQLx migrate, living in
`crates/core/migrations/` (see task `004-initial-migrations`).

Conventions:
- PKs are `uuid` with `gen_random_uuid()` default unless noted.
- All timestamps are `timestamptz`, default `now()`.
- `updated_at` maintained by a `set_updated_at()` trigger on every mutable table.
- Natural dedup key for ingested content: `(source_name, source_id)` — unique.

---

## Enums

```sql
CREATE TYPE item_type       AS ENUM ('bill', 'rule', 'guidance');
CREATE TYPE jurisdiction    AS ENUM ('federal', 'state');
CREATE TYPE review_state    AS ENUM ('pending', 'published', 'rejected');
CREATE TYPE user_role       AS ENUM ('admin', 'subscriber');
CREATE TYPE alert_frequency AS ENUM ('instant', 'daily', 'weekly');
```

---

## Tables

### `items`
One row per tracked bill / rule / guidance document.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| type | item_type NOT NULL | |
| jurisdiction | jurisdiction NOT NULL | |
| state | char(2) NULL | NULL when jurisdiction = 'federal'; uppercase USPS code otherwise |
| title | text NOT NULL | |
| summary | text NULL | Admin-written (v1); plain language for compliance officers |
| status | text NOT NULL | Source-specific status string, e.g. `introduced`, `passed_house`, `final_rule` |
| introduced_at | date NULL | Introduction / publication date |
| source_name | text NOT NULL | `congress_gov`, `federal_register`, `openstates`, `manual` |
| source_id | text NOT NULL | Natural key from source (see SOURCES.md § Dedup keys) |
| source_url | text NOT NULL | Canonical human-readable link |
| raw_json | jsonb NOT NULL | Full source payload, untouched |
| review_state | review_state NOT NULL DEFAULT 'pending' | |
| search_tsv | tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') \|\| ' ' \|\| coalesce(summary,''))) STORED | |
| created_at / updated_at | timestamptz | |

Constraints & indexes:
- `UNIQUE (source_name, source_id)` — ingestion upsert target
- `CHECK (jurisdiction = 'state' OR state IS NULL)`
- `CHECK (jurisdiction = 'federal' OR state IS NOT NULL)`
- GIN index on `search_tsv`
- Index on `(review_state, introduced_at DESC NULLS LAST)` — feeds the public feed
- Index on `(jurisdiction, state)`; index on `type`

### `item_events`
Status timeline for an item (actions, votes, comment deadlines).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| item_id | uuid NOT NULL REFERENCES items ON DELETE CASCADE | |
| event_date | date NOT NULL | |
| event_type | text NOT NULL | e.g. `introduced`, `committee`, `passed_chamber`, `enacted`, `comment_period_close` |
| description | text NOT NULL | |
| created_at | timestamptz | |

Index: `(item_id, event_date)`.

### `tags`
Controlled vocabulary. Seed values: `k12`, `higher-ed`, `athletics`,
`due-process`, `sexual-harassment`, `pregnancy`, `lgbtq`, `religious-exemption`,
`enforcement`, `funding`.

| Column | Type | Notes |
|---|---|---|
| id | integer PK GENERATED ALWAYS AS IDENTITY | |
| slug | text UNIQUE NOT NULL | |
| label | text NOT NULL | |

### `item_tags`
| Column | Type | Notes |
|---|---|---|
| item_id | uuid REFERENCES items ON DELETE CASCADE | |
| tag_id | integer REFERENCES tags ON DELETE CASCADE | |

`PRIMARY KEY (item_id, tag_id)`.

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | citext UNIQUE NOT NULL | case-insensitive; enable `citext` extension |
| password_hash | text NOT NULL | Argon2id |
| role | user_role NOT NULL DEFAULT 'subscriber' | |
| verified_at | timestamptz NULL | NULL = unverified |
| created_at / updated_at | timestamptz | |

### `sessions`
Rust-side cookie sessions (if Phase 0 decision keeps auth in the API).

| Column | Type | Notes |
|---|---|---|
| id | text PK | random 256-bit token, stored hashed (SHA-256) |
| user_id | uuid NOT NULL REFERENCES users ON DELETE CASCADE | |
| expires_at | timestamptz NOT NULL | rolling 30-day |
| created_at | timestamptz | |

Index: `(expires_at)` for the reaper.

### `subscriptions`
Saved filters that drive alerts.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid NOT NULL REFERENCES users ON DELETE CASCADE | |
| name | text NOT NULL | user-facing label, e.g. "Texas K-12 bills" |
| filter_json | jsonb NOT NULL | shape: `{ jurisdiction?, states?: string[], types?: item_type[], tags?: string[], query? }` |
| frequency | alert_frequency NOT NULL DEFAULT 'daily' | |
| active | boolean NOT NULL DEFAULT true | |
| created_at / updated_at | timestamptz | |

### `alerts_sent`
Dedupe log so a user never gets the same item twice per subscription.

| Column | Type | Notes |
|---|---|---|
| id | bigint PK GENERATED ALWAYS AS IDENTITY | |
| user_id | uuid NOT NULL REFERENCES users ON DELETE CASCADE | |
| item_id | uuid NOT NULL REFERENCES items ON DELETE CASCADE | |
| subscription_id | uuid NULL REFERENCES subscriptions ON DELETE SET NULL | |
| sent_at | timestamptz NOT NULL DEFAULT now() | |

`UNIQUE (user_id, item_id, subscription_id)`.

### `ingestion_runs`
Health/observability for the worker.

| Column | Type | Notes |
|---|---|---|
| id | bigint PK GENERATED ALWAYS AS IDENTITY | |
| source | text NOT NULL | matches `items.source_name` |
| started_at | timestamptz NOT NULL DEFAULT now() | |
| finished_at | timestamptz NULL | NULL while running |
| fetched | integer NOT NULL DEFAULT 0 | |
| inserted | integer NOT NULL DEFAULT 0 | new rows (not upsert-touches) |
| error | text NULL | |

Index: `(source, started_at DESC)`.

---

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;
```

## Migration rules (binding for flash tasks)
1. Every migration has an `up` and a tested `down`.
2. No destructive changes to `items.raw_json` or `alerts_sent` — ever.
3. New enum values are additive only (`ALTER TYPE ... ADD VALUE`), never re-create enums.
4. Seed data (tags) lives in its own migration, idempotent via `ON CONFLICT DO NOTHING`.
