# Task 002 — Next.js web scaffold

> Executor: flash model · Reviewer: orchestrator · Phase: 0

## Context
The public web app is Next.js (App Router, TypeScript strict, Tailwind) living
in `apps/web/`. See `docs/PLAN.md` §4–5. Scaffold only — no real pages yet.

## Scope
Create `apps/web/` via `create-next-app` equivalent with:
- TypeScript (`strict: true`), App Router, ESLint, Tailwind CSS, `src/` dir,
  import alias `@/*`
- Package manager: **pnpm** (commit `pnpm-lock.yaml`; add root
  `package.json` with `"packageManager"` pinned)
- `src/app/layout.tsx` — base layout: site header with title "Title IX Policy
  Tracker" and nav placeholders (Feed, Alerts, Sign in); footer with
  "Not legal advice" disclaimer
- `src/app/page.tsx` — redirect to `/feed`
- `src/app/feed/page.tsx` — placeholder: heading "Policy feed" + text
  "Ingestion coming soon."
- `src/lib/config.ts` — exports `API_BASE_URL` read from
  `process.env.NEXT_PUBLIC_API_BASE_URL` with default `http://localhost:3001`
- `.env.example` — `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001`
- `.gitignore` additions: `node_modules`, `.next`, `.env*.local`

Out of scope: API integration, auth, styling beyond the base layout, tests
(Playwright smoke comes with CI task 003).

## Acceptance criteria
1. `pnpm install` succeeds from a clean checkout
2. `pnpm lint` passes with zero warnings
3. `pnpm build` passes (production build, no type errors)
4. `pnpm dev` serves `/feed` rendering the placeholder content
5. No `any` types; no commented-out code

## Constraints
- Next.js 15.x, React 19.x, Tailwind 4.x (or latest stable at scaffold time —
  record chosen versions in the PR description)
- No component libraries yet (no shadcn/radix in this task)
- Do not add API calls; `config.ts` is the only API-related file
