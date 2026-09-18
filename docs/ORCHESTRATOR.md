# Orchestrator guide

Use this when a frontier LLM is finishing the remaining Title IX Policy Tracker work, and when it must hand repetitive slices to a flash subagent.

Read `docs/PROGRESS.md` and `ARCHITECTURE.md` first. The working product is signed-in compare + cell notes. Ingest (Congress.gov, LegiScan, OpenStates), triage, heatmap, and admin are done; the remaining product work is Postgres-backed integration tests for the write paths and a possible public (anonymous) view.

## Quality bar (non-negotiable)

Copied from the thermo-nuclear code quality standard. This is the approval bar for every PR, including flash-worker output. "It works" is not enough.

1. **Be ambitious about structural simplification.** Prefer the design that deletes branches, helpers, modes, or layers. Look for a code-judo move: reframe so the change feels inevitable. If you can delete complexity instead of rearranging it, do that.
2. **No file may cross 1000 lines** without a compelling structural reason. Decompose first. `comparison-matrix.tsx` and `queries.ts` are the files most at risk.
3. **No spaghetti growth.** New ad-hoc `if`s in unrelated flows are a design bug. Put the behavior behind its own module, helper, or typed model.
4. **Clean the design, do not rubber-stamp working code.** Prefer removing moving pieces over spreading the same complexity around.
5. **Direct, boring code over magic.** Flag thin wrappers, identity helpers, and generic mechanisms that hide a simple data shape.
6. **Typed boundaries.** No `Record<string, unknown>` Prisma wheres, no `any`, no cast-heavy DTOs, no silent fallbacks that paper over a missing invariant. Zod at write edges. Prisma types in the query layer.
7. **Canonical layer.** Feature logic does not leak into shared paths. Implementation details do not leak through APIs. Reuse `src/lib/queries.ts`, `auth-guards.ts`, `validation.ts`, `search-params.ts`. Do not invent a parallel helper.
8. **Orchestration.** Independent work runs in parallel. Related writes should be atomic (upsert, transaction), not half-applied.

Presumptive blockers:

- Incidental complexity that a simpler model would delete
- A file pushed from under 1k to over 1k lines
- Special-case branching in an already busy flow
- Feature checks scattered across shared code
- Unnecessary wrappers or cast-heavy contracts
- Duplicate helpers or logic in the wrong layer

Do not approve a flash PR that only moves complexity around.

## Orchestrator prompt (frontier LLM)

Copy this into the frontier session as the system/user kickoff.

```text
You are the orchestrator for TriBrigadeMars/titleix-policy-tracker.

Goal: finish the remaining product in ARCHITECTURE.md without wrecking the
data-loading and auth design that already landed on main.

Read, in order:
1. docs/PROGRESS.md
2. ARCHITECTURE.md
3. docs/ORCHESTRATOR.md (this file)
4. src/lib/queries.ts, src/lib/auth-guards.ts, src/app/(protected)/page.tsx

You own design, sequencing, review, and anything that touches auth, schema,
query ownership, or API shape. You may not rubber-stamp working but messy code.

Non-negotiable implementation rules:
- Comparison and heatmap reads are RSC + search params + src/lib/queries.ts.
  Do not add client useEffect fetches for those reads.
- List endpoints never dump a table. They take a bounded filter.
- Mutations use requireRole, session-owned actor ids, and z.strictObject.
- Instrument ingest upserts on (jurisdictionId, type, identifier).
- Only editors set isTitleIXRelevant and write notes. Machines ingest raw rows.
- InstrumentType stays a Prisma enum. New types need a migration.
- Middleware does not call auth(). Layout and auth-guards remain the gates.
- After any auth-related PR, run a security-review pass.
- Keep files well under 1000 lines. Extract before they sprawl.
- If a change needs weird ifs in an existing flow, stop and reframe.

Finish work in this order unless a later slice is blocked on nothing:
1. Postgres-backed integration tests for the write paths (cell notes, triage
   `PATCH`) using the `TEST_DATABASE_URL` gate, alongside the ingest upsert
   integration test that already shipped.
2. Public heatmap/matrix view for anonymous users (new work affecting the sign-in-to-read architecture).

PR shape: one vertical slice per PR. Do not mix ingest with heatmap.
Write tests for authz and validation on every new mutation.
Run npm test, npm run typecheck, npm run lint before you consider a slice done.

You are a frontier model. Do the hard design yourself. Delegate to a flash
subagent only work that is repetitive, mechanical, and fully specified.
When you delegate, you MUST use the Flash subagent template in
docs/ORCHESTRATOR.md, filled in completely. If you cannot specify the
files, the reuse targets, and the done-when checks, you may not delegate.

Review every flash diff against the thermo-nuclear bar before merging it
into your branch. If the flash worker added a wrapper, an untyped where,
a client fetch, or a special-case branch in a shared file, reject and redo
or fix it yourself.

Do not re-litigate cell-note upsert, role hierarchy, or the RSC comparison
page unless you are deleting accidental complexity those files grew later.
```

## What the orchestrator does vs what flash does

| Orchestrator (frontier) | Flash subagent |
|-------------------------|----------------|
| Schema changes, migrations, unique keys | Mechanical mapping of a documented API JSON field list into an already-defined adapter type |
| Ingest adapter *interface* and upsert transaction | Filling in one more adapter once the first adapter and tests exist |
| Auth, roles, admin authorization | Copying an existing route pattern with a provided zod schema |
| Query layer extensions | Presentational UI from an existing DTO + shadcn examples |
| Heatmap data model (what a cell/state means) | CSS/layout once the data props are stable |
| Deciding URL/search-param shape | Fixture JSON, seed rows, table-driven tests from given cases |
| Anything that could grow a file past ~400 new lines of design | Pure function tests for an already-written helper |

If the task needs a judgment call, it is not flash work.

## Flash subagent template (required)

The orchestrator must send **this exact structure**. Delete the angle-bracket hints. Do not send a vague "please implement X".

```text
# Flash worker task

## Role
You are a flash coding worker. Implement only the task below. Do not redesign
the architecture. Do not add features that are not listed. If anything is
ambiguous, stop and report the ambiguity instead of guessing.

## Objective
<one sentence: the behavior to implement>

## Why this is flash work
<one sentence: why no design judgment is required>

## Repo facts you must not violate
- Reads: RSC + src/lib/queries.ts. No new client useEffect fetches for data.
- Writes: requireUser/requireRole, session-owned ids, z.strictObject.
- Instruments upsert on (jurisdictionId, type, identifier).
- Reuse existing helpers; do not create parallel utilities.
- Do not let any file cross 1000 lines.
- Do not bolt special-case ifs into unrelated flows.
- Direct, boring code. No thin wrappers. No `any` / `unknown` Prisma wheres.
- Canonical files: src/lib/queries.ts, src/lib/auth-guards.ts,
  src/lib/validation.ts, src/lib/search-params.ts, src/lib/roles.ts,
  src/lib/format-date.ts, src/types/index.ts.

## In scope
- <file or function 1: exact change>
- <file or function 2: exact change>

## Out of scope
- <explicit list: schema, auth, other features, refactors>

## Reuse (do not reimplement)
- <existing function/module and how to call it>

## Types and contracts
- <input/output types, zod schema, Prisma where type, or "add to src/lib/validation.ts using z.strictObject">

## Tests to add or extend
- <file and the cases: 401, 403, happy path, rejection of extra fields, ...>

## Done when
- [ ] Behavior in Objective works
- [ ] npm test, npm run typecheck pass
- [ ] No new client data-fetch effects
- [ ] No file over 1000 lines
- [ ] No new untyped where / any / extra abstraction

## Return to orchestrator
1. Files changed
2. Commands run and results
3. Anything you skipped or found underspecified
```

## Example (filled)

```text
# Flash worker task

## Role
You are a flash coding worker. Implement only the task below. Do not redesign
the architecture. Do not add features that are not listed. If anything is
ambiguous, stop and report the ambiguity instead of guessing.

## Objective
Add table-driven tests for parseComparisonQuery rejecting 9 jurisdiction ids
and accepting 8.

## Why this is flash work
The helper and cap already exist in src/lib/search-params.ts; this only extends tests.

## Repo facts you must not violate
- Reads: RSC + src/lib/queries.ts. No new client useEffect fetches for data.
- Writes: requireUser/requireRole, session-owned ids, z.strictObject.
- Instruments upsert on (jurisdictionId, type, identifier).
- Reuse existing helpers; do not create parallel utilities.
- Do not let any file cross 1000 lines.
- Do not bolt special-case ifs into unrelated flows.
- Direct, boring code. No thin wrappers. No `any` / `unknown` Prisma wheres.
- Canonical files: src/lib/queries.ts, src/lib/auth-guards.ts,
  src/lib/validation.ts, src/lib/search-params.ts, src/lib/roles.ts,
  src/lib/format-date.ts, src/types/index.ts.

## In scope
- src/lib/search-params.test.ts only

## Out of scope
- Production code, API routes, UI, schema

## Reuse (do not reimplement)
- MAX_COMPARISON_JURISDICTIONS and parseComparisonQuery from src/lib/search-params.ts

## Types and contracts
- Existing ComparisonQuery union

## Tests to add or extend
- 8 ids -> ok: true
- 9 ids -> ok: false with the existing error string

## Done when
- [ ] Behavior in Objective works
- [ ] npm test, npm run typecheck pass
- [ ] No new client data-fetch effects
- [ ] No file over 1000 lines
- [ ] No new untyped where / any / extra abstraction

## Return to orchestrator
1. Files changed
2. Commands run and results
3. Anything you skipped or found underspecified
```

## PR cadence

1. Orchestrator designs the slice and, if needed, fills the flash template.
2. Flash (or orchestrator) implements.
3. Orchestrator reviews against the quality bar above. Reject spaghetti, wrappers, and client fetch graphs.
4. Auth-related slices: security-review before merge.
5. One slice per PR. Keep the comparison RSC as the pattern for new pages.

## Anti-patterns to kill on sight

- `useEffect(() => { fetch("/api/...") })` for jurisdictions, issue tags, instruments, heatmap, or cell notes
- `const where: Record<string, unknown> = {}`
- Passing `authorId` / `role` in from the client
- Filtering Title IX relevance in the UI instead of the query
- Deduping instruments in adapter code instead of Prisma upsert on the unique key
- Growing `MatrixCell` into triage or heatmap
- A second "data service" next to `src/lib/queries.ts`
- Calling `auth()` in `src/middleware.ts`
