# WP-15B — Deferred: Release pipeline & clean-VM lifecycle testing

Backlog record of workplan **WP-15B**. Context: read `desktop-workplans/00-PROJECT-CONTEXT.md` first (referenced from `electron/README.md`; it lives with the workplans, not in this repo).

- **Prerequisite:** WP-14B complete and approved by the maintainer.
- **Status:** Backlog specification only. **Not implemented — do not implement during Phase 1.**

## Deferred Item 3 — CI/CD release pipeline

Recommended Windows runner pipeline:

```
checkout → npm ci → prisma generate → lint → typecheck (both configs)
→ unit tests → next build → desktop:compile → electron-builder
→ sign artifacts → archive installer (+ latest.yml, checksums)
```

Tagged releases publish `TitleIX-Policy-Tracker-Setup-x.y.z.exe` (matching the `artifactName` in `electron-builder.yml`). "Typecheck (both configs)" means `npm run typecheck` (web, `tsconfig.json`) and `npm run desktop:typecheck` (Electron, `electron/tsconfig.json`). The `sign artifacts` stage depends on WP-15A Deferred Item 1 and must not land before signing credentials exist as CI secrets.

## Deferred Item 4 — Clean-Windows installer lifecycle test

- Run testing on a fresh Windows 11 VM as a standard (non-admin) user.
- Lifecycle: download → install → Start Menu launch → desktop shortcut → authenticate → close → reopen (session persistence) → upgrade → uninstall.

The WP-14 functional smoke items in `docs/DESKTOP-AUDIT.md` are all `PENDING-ENV` and cover part of this surface interactively; this item supersedes them with a clean-VM pass once a release pipeline exists to download from.

## Deferred Item 5 — Bundled server "Enterprise Edition" (rejected for v1)

Packaging the Next.js server and database inside the client executable would leak `DATABASE_URL` and API secrets. Only evaluate in a future self-hosted model where customers supply their own infrastructure. The WP-14 asar audit confirms the current `electron-builder.yml` `files:` block already excludes `src/`, `prisma/`, `.next/`, and every `.env*` — keep it that way.

## Phase 2 future git & PR workflow (reference only)

When implementing CI/CD pipelines:

1. Create a dedicated branch: `git checkout -b desktop/phase2-ci-pipeline`
2. Commit workflows under `.github/workflows/`: `git commit -m "ci(desktop): add Windows electron-builder release workflow"`
3. Push and submit PR:

   ```bash
   gh pr create --base main --head desktop/phase2-ci-pipeline --title "ci(desktop): Windows Release Pipeline" --body "Adds GitHub Actions release workflow for building and packaging the Windows desktop shell."
   ```
