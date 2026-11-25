# titleix-product lane notes

Date: 2026-11-25. Branch: `swarm/product`. Baseline commit: `c2f909a`.

## 1. Audit

### What works on Linux (verified locally)

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | 750 packages, 15s |
| Prisma client | `npm run db:generate` | Generated v6.19.3 |
| Typecheck | `npm run typecheck` | pass |
| Unit/integration suite | `npm test` | 45 files / 603 tests pass, 5 files / 29 tests skipped (no `TEST_DATABASE_URL`) |
| Lint | `npm run lint` | pass ("No ESLint warnings or errors") |
| Production build | `npm run build` | pass, 17 routes |
| Dev app | `next dev -p 3000 -H 127.0.0.1` | `/` 200 (146 KB HTML), `/heatmap` 200 (65 KB), in-memory PGlite demo corpus |

The dev server boots an embedded in-memory PGlite with the demo corpus, so a
cloned repo shows data with no Postgres. Desktop builds and packaging are
owned by the `titleix-platform` lane; not touched here.

### Product gaps found by reading and using the app

1. **No public bill index.** The only public reads are the comparison matrix
   (fixed 8 issue rows) and the state heatmap (counts only). A researcher
   cannot ask "all Texas bills, passed, newest first" or "search for
   athletics". `docs/PLAN.md` §3 lists a feed and item detail as MVP features;
   they were never built.
2. **No bill detail page.** Matrix cards show identifier, title, status and a
   source link. Introduced/passed/effective dates, source provenance
   (`source`, `sourceId`, `lastCheckedAt`) and the raw source summary are in the
   schema but never rendered. There is no permalink for an instrument.
3. **No export.** Journalists and board reports need CSV/JSON. Plan lists export
   as post-MVP, but it is cheap once a listing query exists.
4. **Freshness is a run on a sentence.** `PublicDataFreshness` prints raw source
   ids (`legiscan`, `openstates`, `congress`, `fixture`), has no staleness
   threshold, and lets the failure sentence trail a successful one. No
   accessible "data is stale" signal.
5. **Seed corpus has no legislative dates.** The 10 demo instruments carry no
   `introducedAt` / `passedAt` / `effectiveAt`. Date sorting/display must
   degrade honestly ("not recorded") rather than fabricate dates.
6. **Empty installs are unexplained.** Production seeding installs catalogue
   only (`SEED_DEMO` unset); `/` and `/heatmap` then render empty cells with no
   explanation of how to get data. Windows users cannot set `SEED_DEMO=1`
   inline in PowerShell.
7. **Heatmap is hover-only.** Tiles update a side panel on hover/focus but the
   link has no accessible name and the panel is not announced. Screen-reader
   users get "Link" × 52.
8. **Navigation has no data view.** Header exposes Comparison / Heatmap /
   Triage / Admin only.

Non-gaps: ingest adapters, triage loop, cross-source dedupe, authz, security
headers, mutation validation, existing tests. Not touched.

## 2. Comparison with open-source trackers

| Project | URL | What it does | Adopted | Rejected / why not |
|---|---|---|---|---|
| DataDriven Legislation Tracker (DSSG × ACLU) | https://github.com/dssg/state-leg-tracker | LegiScan ingest, weekly refresh, ML passage probability and topic classification, weekly spreadsheet release | Public per-state listing + downloadable dataset; a weekly static export is normal civic-tech practice | ML classification: no labeled training data here and the editor triage already owns relevance |
| TechEquity CA Legislation Tracker | https://github.com/techequitycollaborative/legislation-tracker | Streamlit + Postgres, LegInfo/OpenStates ingest, "advanced search & filters", bill tracking, Docker | Search/filter as the primary interaction; a bill detail view per record | Streamlit/Python stack; custom advocacy workflow fields (out of scope) |
| Open States site | https://github.com/openstates/openstates.org (site: https://openstates.org/pa/bills?sort=-first_action) | Paginated bill lists with sort params, state/date/sponsor filters, bill detail, public API | URL-encoded list state (`?state=&status=&sort=&page=`) so views are shareable; pagination; machine-readable API | GraphQL/Elasticsearch infrastructure and multi-chamber model |
| GovTrack.us front end | https://github.com/govtrack/govtrack.us-web | Bill pages with status history, source links, RSS/API | Detail pages that show status + dates + primary-source link and cite where the data came from | Django stack, person/vote graph; not in this data model |
| AI Legislation Tracker | https://github.com/delschlangen/ai-legislation-tracker | Machine-readable JSON datasets, permanent record ids, supersession tracking, browser search with no account, zero deps | JSON export with stable record identity; anonymous search/browse | Supersession modeling needs a schema migration; not attempted |
| Firetrack (archived) | https://github.com/vega-holdings/firetrack | Next.js/Prisma tracker: filter by jurisdiction/state/status/keyword, RSS, dashboard | Confirms the filter set (jurisdiction, status, keyword) and Next.js/Prisma fit | Single-state focus, stored auth/migrations differ; no code copied |

Synthesis: every comparable tracker makes *the bill list* the front door and
keeps every row linkable. The heatmap/matrix are good analysis views but a poor
entry point. Export and provenance display are table stakes in civic tech.

## 3. Ranked improvements (impact × effort)

| # | Change | Impact | Effort | Verdict |
|---|---|---|---|---|
| 1 | Public `/bills` index: keyword search, state/status/type filters, sort, pagination, count, empty state | High | M | **Do** |
| 2 | `/instruments/[id]` detail page: dates, tags, provenance (source, source id, last checked), source summary labeled unverified; matrix cards link to it | High | M | **Do** |
| 3 | CSV + JSON export of the public (RELEVANT) dataset, sharing the list filters, hard row cap | High | S | **Do** |
| 4 | Freshness summary helper: source display names, staleness threshold, failed-run warning; unit-tested | Medium | S | **Do** |
| 5 | Heatmap accessibility: per-tile accessible names, `aria-live` details, keyboard parity | Medium | S | **Do** |
| 6 | Empty-install notice with runnable next step; cross-platform `--demo` seed flag | Medium | S | **Do** |
| 7 | Full-text search with `tsvector` GIN index | Medium | L | Reject: schema migration, PGlite parity risk; `contains` over a few thousand rows is enough |
| 8 | Saved filters / RSS / email alerts | Medium | L | Reject: needs scheduler + outbound email, platform lane territory |
| 9 | Bill status history timeline | Medium | L | Reject: no action-history table; ingest only stores current status |
| 10 | Dark-mode heatmap palette | Low | S | Reject: colors are inline HSL, not theme-aware; UX-only |

### Chosen scope

Items 1–6. Constraints honored:

- Public reads stay `triageStatus = RELEVANT` only; triage/internal notes never
  become public.
- New API route (`/api/export/instruments`) is bounded by `MAX_EXPORT_ROWS =
  1000` and takes the same validated filters; it does not dump an unbounded
  query. `ARCHITECTURE.md` is updated to state this.
- No schema migration. No new dependency. No files under `electron/`,
  `src-tauri/`, `.github/workflows/`, `packaging/` (platform lane).
- Demo corpus is not given invented legislative dates; UI says "Not recorded".

## 4. Verification plan

`npm ci`, `npm run db:generate`, `npm run typecheck`, `npm test`,
`npm run lint`, `npm run build`, then exercise `/bills`, a filtered query,
`/instruments/<id>` and both export formats against the dev server with the
seeded PGlite corpus.

## 5. Result (implementation)

Late audit correction: `src/middleware.ts` gated every path except `/`,
`/heatmap`, `/sign-in` and `/api/auth`. The "public read-only" comparison and
heatmap were anonymous, but a new list/detail/export would have redirected to
sign-in. Since those pages read the same `RELEVANT` rows the matrix already
shows, `/bills`, `/instruments` and `/api/export` were added to the public
prefix set. `/api/instruments` and `/api/cell-notes` stay behind auth.

Shipped:

- `src/lib/bill-query.ts` — URL parsing with bounds, `billWhere()` predicates
  (`triageStatus: "RELEVANT"` always), `billOrderBy()` with undated rows last,
  filter/page URL builders.
- `src/lib/instrument-export.ts` — RFC 4180 CSV (UTF-8 BOM, quoted fields, ISO
  timestamps) and the JSON payload mapping.
- `src/lib/freshness.ts` + `src/lib/sources.ts` — summary/warning computation
  and adapter display names.
- `src/lib/queries.ts` — `getInstrumentListing`, `getInstrumentExportRows`
  (1,000-row cap), `getInstrumentDetail` (RELEVANT only), `countPublicInstruments`;
  `Instrument.lastCheckedAt` exposed.
- `src/app/(public)/bills/page.tsx` — server-rendered GET form, table,
  pagination, counts, export links, three empty states.
- `src/app/(public)/instruments/[id]/page.tsx` — dates, issue links,
  provenance, unverified source summary, editor-only notes, 404 for unpublished.
- `src/app/api/export/instruments/route.ts` — public CSV/JSON, attachment
  headers, `X-Total-Count`, `X-Result-Truncated`.
- Heatmap accessible names and `aria-live` details; branded 404; empty-install
  notice on `/`, `/bills`, `/heatmap`; Bills nav item; matrix titles link to
  detail pages.
- `npm run db:seed:demo` (`--demo` flag) for PowerShell-usable demo seeding.
- Tests: `bill-query` (17), `instrument-export` (8), `freshness` (7),
  `sources` (3), export route (6), middleware (+3), public page (+2).

Rejected as planned: tsvector search, RSS/alerts, status history, saved filters.

## 6. Verification (actual)

Commands run in this worktree after the final commit contents:

```
npm ci            -> added 750 packages
npm run db:generate -> Generated Prisma Client (v6.19.3)
npm run typecheck -> pass (tsc --noEmit, no output)
npm test          -> 50 files passed | 5 skipped; 646 tests passed | 29 skipped
npm run lint      -> No ESLint warnings or errors
npm run build     -> pass; 20 routes incl. /bills and /instruments/[id]
```

Runtime smoke against `next dev` with the embedded PGlite demo corpus:

| Request | Result |
|---|---|
| `/` | 200 |
| `/bills` | 200, "Showing 1–10 of 10" |
| `/bills?q=athletics&status=PASSED&sort=oldest` | 200, 1 result |
| `/bills?limit=3&page=2` | 200, "Showing 4–6 of 10", prev/next links |
| `/bills?q=zzzz` | 200, no-match empty state |
| `/instruments/<id>` | 200, provenance + "Not recorded" dates |
| `/instruments/nope` | 404 |
| `/api/export/instruments?format=csv` | 200, BOM + 10 rows |
| `/api/export/instruments?format=csv&jurisdiction=CA` | 2 rows |
| `/api/export/instruments?format=json&jurisdiction=CA&q=athletics` | count 1 |
| `/api/export/instruments?format=pdf` | 400 |

Windows was not executed locally; the only Windows-relevant change is the
cross-platform `--demo` seed flag and server-rendered GET form (no inline env
vars, no shell scripts).
