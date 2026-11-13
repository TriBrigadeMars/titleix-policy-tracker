# Ingestion Sources — Title IX Policy Tracker

> Status: v1 · 2026-09-17 · Owner: orchestrator.
> ⚠️ Rate limits and endpoint details marked *(verify)* must be confirmed
> against the provider's current docs during implementation and this file
> updated with the confirmed values.

All sources share this contract (implemented once in `crates/worker`):

1. Fetch → normalize to a `NewItem` struct → **upsert** on
   `(source_name, source_id)`.
2. New rows always land with `review_state = 'pending'`. Nothing is public
   without admin approval.
3. The full provider payload is stored verbatim in `items.raw_json`.
4. Every run writes one `ingestion_runs` row (start, finish, counts, error).
5. Relevance is two-stage: (a) provider-side query narrows results,
   (b) local keyword scoring against title/summary decides insert-vs-skip.
   Matched keywords are recorded in `raw_json._match` for the reviewer.

### Shared keyword list (stage b)
Primary (any match → candidate):
- `title ix`, `title 9`, `20 u.s.c. 1681`, `34 c.f.r. part 106`
Contextual (require co-occurrence with `education`, `school`, `student`,
`college`, `university`, `district`, `athletics`):
- `sex discrimination`, `sex-based harassment`, `sexual harassment`,
  `nondiscrimination on the basis of sex`, `pregnant and parenting students`

---

## 1. Congress.gov API (federal bills)

- **Base URL:** `https://api.congress.gov/v3/`
- **Auth:** API key from api.data.gov signup; `api_key` query param or
  `X-Api-Key` header. Key is a deployment secret (`CONGRESS_GOV_API_KEY`).
- **Rate limit:** hourly per-key cap *(verify current value; plan for
  conservative polling with exponential backoff on 429)*.
- **Endpoints:**
  - `GET /bill?fromDateTime=...&toDateTime=...&sort=updateDate+desc` — recent bills
  - `GET /bill/{congress}/{billType}/{billNumber}` — detail
  - `GET /bill/{congress}/{billType}/{billNumber}/actions` — timeline → `item_events`
  - `GET /bill/{congress}/{billType}/{billNumber}/summaries` — CRS summary
- **Query strategy:** the API's full-text search is limited; poll bills updated
  since the last successful run and apply the local keyword stage to
  title + summary. *(verify whether `query` param support has improved; if so,
  use provider-side search for `title ix` as an additional sweep.)*
- **Dedup key (`source_id`):** `{congress}-{billType}-{billNumber}`, e.g. `119-hr-1234`.
- **Cadence:** every 6 hours.
- **Mapping:** type=`bill`, jurisdiction=`federal`, state=NULL,
  status ← latest action text; introduced_at ← `introducedDate`.

## 2. Federal Register API (rules, proposed rules, notices)

- **Base URL:** `https://www.federalregister.gov/api/v1`
- **Auth:** none required.
- **Rate limit:** generous; still back off on 429 *(verify current guidance)*.
- **Endpoint:** `GET /documents.json` with:
  - `conditions[term]=Title IX` (plus a second sweep for
    `nondiscrimination on the basis of sex`)
  - `conditions[agencies][]=education-department`
  - `conditions[type][]=RULE|PRORULE|NOTICE`
  - `conditions[publication_date][gte]={last successful run date}`
  - `per_page=100`, paginate via `next_page_url`
- **Dedup key (`source_id`):** `document_number` (e.g. `2026-01234`).
- **Cadence:** daily (FR publishes each federal business day).
- **Mapping:** type=`rule` (RULE/PRORULE) or `guidance` (NOTICE, case-by-case
  in review); jurisdiction=`federal`; status ← `type` + `comments_close_on`;
  `comments_close_on` also creates an `item_events` row of type
  `comment_period_close` when present.

## 3. OpenStates API v3 (state bills)

- **Base URL:** `https://v3.openstates.org`
- **Auth:** API key, `X-API-KEY` header (`OPENSTATES_API_KEY` secret).
- **Rate limit:** tiered by account *(verify current tier; the free tier may
  require spreading state polls across the day)*.
- **Endpoint:** `GET /bills` with:
  - `jurisdiction={state name}` (52 jurisdictions incl. DC/PR)
  - `q="Title IX"` and a second sweep with `q="sex discrimination"`
  - `sort=updated_desc`, `updated_since={last successful run}`
  - `include=actions` for timeline → `item_events`
- **Dedup key (`source_id`):** the OpenStates `id` (`ocd-bill/...`); fallback
  `{state}-{session}-{identifier}`.
- **Cadence:** daily per jurisdiction, staggered.
- **Mapping:** type=`bill`, jurisdiction=`state`, state ← jurisdiction USPS
  code; status ← latest action description; introduced_at ← first action date.
- **Coverage gaps:** some states have incomplete action histories or lag.
  Known-gap handling (log + surface in ingestion health) is v1; per-state
  fallback scrapers are post-MVP.

## 4. Manual entry (ED guidance / Dear Colleague letters)

- v1: admins enter via the dashboard (`source_name = 'manual'`,
  `source_id = 'manual-{uuid}'`), linking the canonical ed.gov URL.
- Auto-ingestion of OCR guidance is post-MVP (see PLAN.md §3).

---

## Secrets required (deployment)

| Env var | Source |
|---|---|
| `CONGRESS_GOV_API_KEY` | api.data.gov |
| `OPENSTATES_API_KEY` | openstates.org account |
| `DATABASE_URL` | Postgres |
| `EMAIL_API_KEY` | Resend/Postmark (Phase 4) |
