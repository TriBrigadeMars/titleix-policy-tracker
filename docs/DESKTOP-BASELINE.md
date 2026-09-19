# Desktop Baseline (WP-01)

Baseline verification of the existing web app **before** any Electron code exists.
This is the safety net every later desktop workplan relies on.

## Environment

- Date: 2026-09-19
- Node: v22.23.2
- npm: 12.0.2
- OS: Windows
- Branch: `tribrigademars-wp-01-baseline-verification` (worktree of `main` @ `e31a0e7d`)

## Results

| # | Command | Result | Notable output |
|---|---------|--------|----------------|
| 1 | `npm ci` | ✅ pass | 487 packages added, 488 audited. 8 vulnerabilities reported (5 high, 3 critical) — pre-existing, not addressed here. 6 install scripts (prisma, esbuild, sharp, unrs-resolver) blocked by npm `allowScripts` config; did not affect install. |
| 2 | `npm run db:generate` | ✅ pass | Prisma Client v6.19.3 generated to `node_modules/@prisma/client`. |
| 3 | `npm run typecheck` | ✅ pass | `tsc --noEmit` clean. |
| 4 | `npm test` | ✅ pass | 19 test files passed, 3 skipped; **235 tests passed**, 21 skipped (256 total). Duration 8.56s. |
| 5 | `npm run lint` | ✅ pass | `next lint` — no warnings or errors. |
| 6 | `npm run build` | ✅ pass | Next.js 15.3.5 production build compiled in 38.0s; 13 static pages generated; all routes listed. |

## Notes

- No `.env` / `.env.local` present. Build succeeded without one (no DB connection needed at build time).
- No application code was changed in this workplan. `git status` clean apart from this file.
- `npm test` currently passes: **235 passed / 21 skipped**.