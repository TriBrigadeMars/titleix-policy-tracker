# Title IX Policy Tracker — session handoff

**Date:** 2026-09-17  
**Session:** Work so far (`1e6d5c14-4b28-4c96-9f7d-683b90fbf384`)  
**Repo:** TriBrigadeMars/titleix-policy-tracker  
**Branch:** `tribrigademars-work-so-far`  
**Prior planning branch:** `tribrigademars-orchestrator-app-strategy` (commit `0e89037`)  
**Worktree:** `C:\Users\tlfalke\copilot-worktrees\titleix-policy-tracker\tribrigademars-scaling-telegram`  
**Repo state:** greenfield (README title only). Now starting scaffold.

---

## Original ask

Design an action plan to build a large app with:

- **Orchestrator (frontier):** Grok 4.6 or Fable 5.1 — this session's role
- **Cheap workers:** DeepSeek v4.1 Flash or Qwen 3.8 Flash (in-session `task` subagents and/or child sessions)

User wanted both a **thin MVP spec** and an **orchestration playbook**, as a written plan, no coding. Then: discuss first (empty repo). Then: disconnect — save for pickup.

---

## Locked product decisions

| Topic | Decision |
|---|---|
| Primary users | Researchers, advocates, journalists — **not** campus Title IX coordinators |
| Product type | Legislative/regulatory **impact tracker**, not a per-school policy archive |
| Core job | Compare **proposed or recently passed** laws, regulations, and/or policies at **state and federal** level that can impact Title IX |
| Corpus | **All 50 states + federal** (product goal). Implement in phases (see below). |
| Ingest | **Hybrid:** APIs for bills/status; humans **or frontier model** for Title IX relevance + comparison notes |
| Core UX | **Topic matrix:** rows = Title IX issues; columns = jurisdictions; cells = **current rule + pending bills** |
| Matrix columns | User **picks 2–8 jurisdictions** for the detailed matrix, plus a **50-state heatmap overview** |
| Access | **Public read** + **signed-in editors** who tag relevance and write comparison notes |
| Legal rule | Flash models **never author legal conclusions**. Machines track status; frontier/human decide relevance and notes. |
| **Tech stack** | **Next.js 15 (App Router) + TypeScript + PostgreSQL + Prisma + NextAuth.js + Tailwind CSS + shadcn/ui** |
| **Auth provider** | **Google OAuth** (free, simple consent screen) |
| **Instrument types (v1)** | **Bills, statutes, regulations** — extensible schema supports guidance, EOs, court orders later |
| **Heatmap** | **Green/yellow/red** by pending Title IX-relevant instrument count per state |
| **Export (v1)** | **CSV download** of comparison matrix + bibliography citation list |

### V1 matrix rows (locked)

1. Who is covered — sex, sexual orientation, gender identity  
2. Athletics eligibility  
3. Facilities & housing — bathrooms, lockers, dorms  
4. Harassment standard — what conduct is covered  
5. Grievance / due process — notice, hearings, evidence, advisors  
6. Pregnancy & parental status  
7. Religious and statutory exemptions  
8. Reporting duties & retaliation  

Each cell: current rule + pending bills/regs, with **source**. Not a legal opinion.

### Explicit non-goals (v1)

- Per-school / campus policy archive (later)
- Student/parent portals
- Individual complaint / case management
- Billing / multi-tenant SaaS
- Flash-authored legal analysis
- Scraping all 50 states on day one

### Implementation phasing (locked)

1. Schema supports US + all 50 states from day one  
2. Ingest **federal** first  
3. Fan-out **per-state** flash jobs to fill bill/status templates  
4. Frontier/human tags Title IX relevance and writes comparison notes  

---

## Suggested domain sketch (not locked — next session should refine)

**Jurisdictions:** `US` + 50 states  

**Instruments (v1):** bills, statutes, regulations; later: guidance, EOs, injunctions (extensible schema)

**Instrument fields (draft):**
- jurisdiction, type (enum — extensible), identifier (bill no. / CFR / chapter)
- title, status (proposed / passed / effective / enjoined / repealed)
- introduced / passed / effective dates
- source URL, last-checked-at
- raw summary from API

**Analysis layer (frontier/human only):**
- Title IX relevant? (bool + confidence)
- issue tags (the 8 rows)
- cell notes (current rule vs pending)
- citation

**Users:**
- public anonymous read
- editor role (signed in) for tags/notes

**Screens (draft):**
1. Heatmap — 50 states, color by pending Title IX-relevant change
2. Compare — pick 2–8 jurisdictions, 8-row matrix, cells drill to instrument list + notes
3. Instrument detail — source, status timeline, tags, notes
4. Editor — inbox of new/changed API records to triage

---

## Open questions (resolved)

1. ✅ **Tech stack:** Next.js 15 + TypeScript + PostgreSQL + Prisma + NextAuth.js + Tailwind + shadcn/ui  
2. ✅ **Auth provider:** Google OAuth  
3. ✅ **Instrument types:** Bills, statutes, regulations (extensible schema for future types)  
4. ✅ **Heatmap coloring:** Green/yellow/red by pending count  
5. ✅ **Export:** CSV + bibliography in v1  
6. ❓ **APIs:** Congress.gov, LegiScan, OpenStates, GovInfo/eCFR, state sites — which paid keys? (still open)  
7. ❓ **Editor permission granularity** (still open)  
8. ❓ **K-12 vs higher-ed as a filter vs implicit in issue rows** (still open)  

---

## Orchestration playbook

### Roles

| Role | Who | Owns |
|---|---|---|
| Orchestrator | This session / Grok 4.6 or Fable 5.1 | Product, architecture, schema, auth/security, kickoff contracts, review, "is this done?", legal-note quality |
| In-session flash | `task` subagents (DeepSeek/Qwen flash) | Same worktree: tests, boilerplate, mechanical edits, research in *this* repo |
| Child session flash | `create_session` with cheap model | One branch ≈ one PR: CRUD, UI from spec, ingest adapters, docs |

**Mental model:** one child session ≈ one branch ≈ one PR. Do **not** spawn sessions until a written contract exists. Do **not** orchestrate a single-file change.

### Frontier-only tasks

- Product scope and taxonomy changes  
- Data model / migrations that encode legal meaning  
- Auth, authorization, secrets  
- Title IX relevance tagging and comparison notes  
- Ambiguous bugs, security, merge conflicts  
- Reviewing flash diffs before merge  
- Writing kickoff prompts and definition of done  

### Flash-safe tasks (only with a contract)

- Scaffold from a locked stack  
- CRUD matching an OpenAPI/schema  
- UI from wireframe + component rules  
- API client wrappers for Congress.gov / LegiScan / etc.  
- Unit/integration tests, lint, docs  
- Per-state ingest **templates** (status fields, URLs) — not legal tagging  

### Kickoff contract (required for every flash job)

Include: goal, in-scope files, out-of-scope, schema/API snippets, commands to run, definition of done, "do not invent legal conclusions."

### Suggested PR stack

1. **Scaffold + lint/ci** — Next.js 15, Prisma, NextAuth.js, shadcn/ui, CI workflow  
2. **Schema + migrations** — jurisdictions, instruments, tags, notes, users  
3. **Auth** — Google OAuth, editor role middleware  
   - 🛡️ **Mandatory review checkpoint:** run `security-review` agent on this PR before merging. Audit OAuth flow, session handling, role middleware, and protected route enforcement. Fix all 🔴/🟠 findings before continuing.
4. **Federal ingest adapter** — Congress.gov / GovInfo client  
5. **Instrument admin/editor triage UI** — list, detail, tag, note  
6. **Heatmap** — 50-state overview with green/yellow/red  
7. **Compare matrix** — pick jurisdictions, 8-row matrix, drill-down  
8. **Export** — CSV + bibliography  
9. **Per-state ingest fan-out** — many small PRs, one region/state group at a time  

Parallelize only independent slices (e.g. heatmap UI vs federal ingest) after schema exists.

### Review cadence

| Checkpoint | Trigger | Tool / Method | Scope |
|---|---|---|---|
| After PR #3 (Auth) | Before merge | `security-review` agent task | OAuth config, session handling, role middleware, protected routes, secret management |
| After PR #8 (MVP complete) | Before per-state fan-out | Full codebase audit + `security-review` | Architecture, schema correctness, API client security, UI auth boundaries |
| Per PR (ongoing) | CI green + frontier spot-check | PR diff review in Copilot App | Scope creep, flash-invented legal conclusions, obvious bugs |

**Skip reviews between** PRs #4–#8 unless a PR touches auth, secrets, or the data model.

---

## Copilot App notes

- Skill `orchestrate`: announce plan before spawning; `coordinate_with_creator: true`; complete standalone kickoffs  
- `kickoff.mode: plan` + `notify_on_idle` when the child should propose first  
- Default `autopilot` only for well-specified execution  
- Single-repo research stays in the orchestrator session; don't spawn a child just to read this repo  

---

## Next session — do this first

1. Read this file (`PLAN.md`) in the repo root.  
2. Resolve remaining open questions (API keys, editor permissions, K-12 filter).  
3. Lock a short data model in `prisma/schema.prisma`.  
4. Scaffold PR #1 (scaffold + lint/ci).  
5. Keep the frontier session as orchestrator; flash gets contracts, not vague "build the app."
