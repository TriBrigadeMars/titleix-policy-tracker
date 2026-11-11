# MVP plan for a usable Title IX tracker

Product gate for a researcher or journalist. The code slice in [OPTIONAL-REMAINING.md](./OPTIONAL-REMAINING.md) stays as-is. This plan is the gap between that slice and a comparison someone can open and trust.

| Snapshot | Value |
|----------|--------|
| Current plug-and-play fit | 3 / 10 |
| Tasks that must pass unaided | 4 (T1–T4; T5 is the freshness check) |
| Stress scenarios before ship | 6 |
| Out of this MVP | New instrument types, desktop signing, public JSON APIs, saved widgets, bulk “mark relevant” |

## Ship sentence

A signed-out reader opens the site, sees a current federal-and-state comparison with sources, and can tell an empty cell from missing coverage. An editor keeps that picture true. Ingest runs on a schedule. The build ships when the task script and the stress table pass together.

## Sequence

Phase 0 first, so the empty-database failure is on record. Then the first view, then data that arrives on its own, then the editor loop that fills the cells that view depends on. Phase 4 runs against each slice and is the only ship gate.

## Phase 0 — Measure the current product before changing it

Record a baseline so later work is judged against tasks and timings, not against the engineering checklist in [OPTIONAL-REMAINING.md](./OPTIONAL-REMAINING.md). That checklist already marks the code MVP as shipped.

| Work | Build | Done when |
|------|--------|-----------|
| Scripted tasks | Five tasks below, run by one operator on a seeded database and again with an empty one. Record success, time, and the exact dead end. | Written baseline with times. Empty-database run is expected to fail T1 and T2. |
| Data census | Count instruments by triage status, issue-tag coverage, jurisdictions with `lastCheckedAt`, and cell notes per issue tag. | One query report checked into the eval notes. Heatmap gray tiles explained by those counts. |
| Test map | List which paths are unit-only, Postgres-gated, or untested in a browser. Known holes: Playwright, auth-guard DB round-trip, instrument-note integration tests. | Gap list attached to Phase 4. No new product code in this phase. |

**Baseline doc:** [PRODUCT-BASELINE.md](./PRODUCT-BASELINE.md) (tasks, census files under [eval/](./eval/), test map).

## Phase 1 — A signed-out visitor sees a comparison without configuring it

The public matrix currently renders only after `?j=` has two codes, and an empty cell says “No data” whether nothing exists, nothing is relevant, or a relevant bill has no issue tag.

| Work | Build | Done when |
|------|--------|-----------|
| Default comparison | Opening `/` with no query loads a fixed starter set (federal plus two states that have data). The selector still writes `?j=` and caps at 8. | Cold open shows the matrix. Shareable URL still round-trips. |
| Honest empty cells | Split “no relevant instruments”, “relevant but untagged”, and “no editor note”. Keep the untagged row. Name jurisdictions in column headers, not only codes. | A reader can say why a cell is blank without opening triage. |
| Stable reload | Jurisdiction changes keep the previous matrix visible while the server render is pending, with a small pending indicator. Do not replace the table with a single loading sentence. | Switching CA for TX does not flash the empty state. |
| Freshness line | Show the oldest and newest `lastCheckedAt` among instruments in the current comparison, and the same on the heatmap. | A visitor can tell whether the picture is from this week. |

## Phase 2 — Bills arrive without an admin pressing POST

Ingest is three admin-only routes. OpenStates is one jurisdiction and one page per call. LegiScan dumps a whole session when `limit` is omitted. Nothing is scheduled, and a full legislative firehose will drown triage.

| Work | Build | Done when |
|------|--------|-----------|
| Demo corpus | A checked-in, reviewed fixture (federal plus a handful of states) seeds a usable matrix when API keys are absent. Live ingest updates those rows. It does not replace the fixture with an unreviewed dump. | `npm run db:seed` plus fixture yields a non-gray heatmap and a matrix with sources. |
| Scheduled ingest | One job runner calls the existing adapters on a cadence. Congress: current congress, bounded pages. OpenStates: an explicit jurisdiction list, paginated until a cap. LegiScan: session id required. Failures log server-side and leave a run record. | A run finishes or fails with no human request. Missing API key fails closed, as the adapters already do. |
| Candidate filter | Before upsert, drop bills whose title and summary miss a maintained Title IX term list. Record the drop count. Editors still mark `RELEVANT`. The filter only shrinks the unreviewed queue. | A state session does not insert thousands of unrelated bills. Filter terms live in one module with table tests. |
| Run record | Persist source, `startedAt`, `finishedAt`, upserted, skipped, error class. The freshness line reads this, not a guess. | A failed chunk is visible. Retry of the same run does not duplicate rows. |

## Phase 3 — One person can keep the matrix true

Public quality depends on triage status plus issue tags. The triage screen already filters and edits one instrument at a time. The MVP loop is: queue, decide, tag, note, see it on the public matrix.

| Work | Build | Done when |
|------|--------|-----------|
| Queue that matches the matrix | Default triage view is `UNREVIEWED` candidates from the latest run, with a count. Relevant-but-untagged is a second saved filter, because those bills already miss the issue rows. | An editor can clear the queue that blocks the public cells. |
| One-instrument pass | Keyboard or a single dialog still sets triage, confidence, issue tags, and one instrument note. After save, the next unreviewed row opens. No bulk relevance. | Ten instruments triaged without returning to the filter toolbar each time. |
| Public check | From the editor, a link opens `/?j=` with that jurisdiction and scrolls to the issue tag just assigned. | The editor confirms the public cell without reconstructing the URL. |
| Note integrity tests | Postgres integration tests for instrument-note `POST` and `DELETE`, mirroring cell notes: `authorId` from the session, 401 and 403, delete keeps the note when the user is removed (`onDelete: SetNull`). | `TEST_DATABASE_URL` suite covers instrument notes. CI already runs that database. |

## Phase 4 — Ship only after the eval script and the stress suite pass

Phase 4 is the gate, not a polish pass. Feature work in Phases 1–3 is unfinished until the matching row here is green on the same build.

| Work | Build | Done when |
|------|--------|-----------|
| Usability rerun | Repeat the five tasks on a production-like dataset. Target: T1–T4 pass for a person who has not seen the admin routes. T5 passes from the freshness line. | Times at or under the targets in the task table. Failures become bugs, not footnotes. |
| Browser suite | Playwright: signed-out `/` and `/heatmap`, default comparison, heatmap tile to `/?j=US,{code}`, `/triage` redirects, editor cell-note save visible after reload, reader receives 403 on `PUT`. | CI job, not a local-only script. |
| Stress suite | Run the six scenarios in the stress table against Postgres. Record p95 and error counts. No new endpoint that returns unbounded rows. | Numbers stored next to the baseline. Regressions fail the gate. |
| Authz regression | Role matrix on every write route: anonymous, `READER`, `EDITOR`, `ADMIN`. Public path matcher stays exact for `/`. Invalid session cookie does not authorize a write. Self-demotion still blocked. | Table-driven test. Middleware remains cookie-presence only. |

## Evaluation script

Same five tasks at baseline and at the gate. Operator notes the clock and the first sentence the user says when they stall. Source: current routes in `src/app`, reviewed 6 Nov 2026.

| Task | Path | Pass | Time |
|------|------|------|------|
| T1 Name activity | Open `/heatmap`, name a hot state, open its federal comparison | Lands on `/?j=US,{code}` with a matrix, no sign-in | 60s |
| T2 Read one issue | On that comparison, state the athletics picture for both columns and open one source | Answer uses a bill or a note, and the user does not have to interpret “No data” | 90s |
| T3 Stay signed out | Try `/triage` and try to edit a cell note | Triage redirects to `/sign-in`. No pencil. `PUT` without a session is 401 | 30s |
| T4 Editor loop | Sign in as `EDITOR`, mark one bill relevant, tag athletics, write the cell note, reload the public URL | The note and the bill are in that cell. Author is the session user | 4 min |
| T5 Freshness | Say when this comparison was last checked | The page shows `lastCheckedAt` or the ingest run time. No admin screen required | 20s |

## Stress and failure tests

Run against Postgres with `TEST_DATABASE_URL`. Targets are local-CI budgets, not a production SLA. A hang or a 500 fails even if p95 is inside the budget.

| Scenario | Load | Assert |
|----------|------|--------|
| S1 Heatmap aggregation | 52 jurisdictions, 5,000 instruments, tags on a subset | `getHeatmapSummaries` p95 under 1.5s. Issue-tag count stays one SQL group, not a row load. |
| S2 Wide comparison | 8 jurisdictions, 200 relevant instruments, notes on every cell | Server render p95 under 1s. No client fetch of the full instrument table. |
| S3 Note writes | 20 concurrent `PUT`s on distinct cells, then 20 on one cell | Distinct cells all commit. One cell stays one row. No 500. `authorId` is never taken from the body. |
| S4 Ingest resume | 3,000 raw rows, chunk size 50, fail the 10th chunk, then retry | Earlier chunks remain. Editor triage and notes unchanged. Retry converges on the unique key. |
| S5 Upstream hang | Adapter peer that never responds | Abort at 10s. Route returns the generic 502. Body contains no API key or upstream URL. |
| S6 Anonymous read | 50 concurrent `GET /` and `GET /heatmap` | All 200. No session cookie required. Write routes in the same burst still 401. |

## Ship gate

All six must be true on one build. A green unit suite alone does not ship.

| Gate | Evidence |
|------|----------|
| T1–T5 pass | Eval notes with times |
| Playwright CI green | The browser job on that commit |
| S1–S6 recorded | p95 and error counts next to the baseline |
| Role matrix green | Anonymous, reader, editor, admin |
| Fixture boots | Seed without API keys shows the starter comparison |
| Freshness visible | Public page shows the last successful run |

## Leave out of this MVP

These are real follow-ons. Pulling them in delays the gate.

| Item | Why it waits |
|------|----------------|
| `GUIDANCE`, executive orders, court opinions | Needs a Prisma enum migration and new filters |
| Public JSON list APIs | Pages already read through server components |
| Electron signing and auto-update | The web comparison is the product |
| Saved dashboards and widgets | One matrix and one heatmap are the whole surface |
| Bulk “mark relevant” | A bad bulk action publishes noise on the public matrix |
