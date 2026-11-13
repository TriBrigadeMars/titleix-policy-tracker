# Phase 2 Build Plan — Desktop Release Pipeline, Signing & Auto-Updates

**Status:** PARTIALLY IMPLEMENTED — see `docs/PHASE2-STATUS.md` for exactly what landed, what is blocked, and what the maintainer still needs to supply. Slices B and C are implemented and locally verified; Slice A and the sign stage of B need a signing certificate, and Slice D needs a clean Windows 11 VM.
**Scope source:** WP-15A (Deferred Items 1–2) and WP-15B (Deferred Items 3–4), recorded in `docs/DESKTOP-SIGNING-UPDATES.md` and `docs/DESKTOP-RELEASE-PIPELINE.md` (both on `main` via PR #34).
**Prerequisite (per both workplans):** WP-14B complete and approved by the maintainer. WP-14's audit is `docs/DESKTOP-AUDIT.md`. Read `desktop-workplans/00-PROJECT-CONTEXT.md` first (it lives with the workplans, not in this repo).
**Quality bar:** every PR must clear the thermo-nuclear standard in `docs/ORCHESTRATOR.md` — structural simplification, no file over 1000 lines, no thin wrappers, typed boundaries, canonical helpers. One vertical slice per PR; never mix ingest/product work with desktop release work.

Phase 2 turns the desktop shell that already builds locally (`desktop:pack`, `desktop:dist:win`) into a **signed, published, self-updating** release. It is infrastructure and packaging only — no product/feature changes to the Next.js app.

## Current state (what Phase 2 builds on)

- Electron shell: `electron/main.ts`, `preload.ts`, `security.ts`, `window-state.ts`, `constants.ts`, `offline.html` — WP-01…WP-14 done and audited. `electron/placeholder.ts` is now dead (the tree compiles for real) and can be deleted as cleanup in the first slice that touches `electron/`.
- Packaging: `electron-builder.yml` (NSIS, `oneClick: false`, `artifactName: "TitleIX-Policy-Tracker-Setup-${version}.${ext}"`, `files:` excludes `src/`, `prisma/`, `.next/`, `.env*`).
- **Known gap (WP-14 audit):** no `repository` field in `package.json` and no `publish:` block in `electron-builder.yml`. `desktop:dist:win` therefore crashes at the post-build `updateInfoBuilder.computeChannelNames` step (`Cannot read properties of null (reading 'channel')`) *after* the installer is written. **Phase 2 must fix this properly** (a real `repository` field + a real publish config), not paper over it.
- **No code signing** today: `electron-builder.yml` has no `win.certificate*` block. The WP-14 audit noted `signtool.exe` runs only as electron-builder's default self-sign step, not with a real certificate.
- **No update mechanism** today: no `electron-updater` / `electron-log`, no update check anywhere in `electron/`.
- CI: `.github/workflows/ci.yml` is **ubuntu-latest** and covers `npm ci → db:generate → migrate deploy → lint → typecheck → build → test` (Postgres service; `TEST_DATABASE_URL` turns on the DB-backed suites). It does **not** run `desktop:typecheck`, `desktop:compile`, or `electron-builder`, and it does not publish anything. There is no release workflow.

## Hard rules (do not violate)

1. **Signing credentials are CI secrets. NEVER commit `.pfx` files, certificates, passwords, tokens, or cloud credentials to Git.** Use GitHub Actions secrets (and an EV/cloud-HSM signing service if the maintainer supplies one). A committed cert is an instant, non-negotiable reject.
2. **Do not weaken the packaged-app secret boundary.** WP-14's asar audit (items 11–16) proved `app.asar` contains no `.env`, `DATABASE_URL`, `AUTH_*`, `CONGRESS_GOV`, `OPEN_STATES`, or `LEGISCAN` material. Any change to `electron-builder.yml` `files:` must preserve that.
3. **No bundled server.** WP-15B Deferred Item 5 rejected packaging the Next.js server + database in the client (it would leak `DATABASE_URL`/API secrets). The desktop shell stays a thin client against `DESKTOP_APP_URL`. Do not revisit this in Phase 2.
4. **Update signatures are mandatory.** Auto-update must strictly verify artifact signatures; a tampered binary must never install. If signing (Slice A) is not yet available, ship **no** updater — do not ship an unsigned update channel.
5. **Do not regress the WP-14 security posture** (20 checklist items in `docs/DESKTOP-AUDIT.md`): `contextIsolation`/`sandbox` on, `nodeIntegration`/`webSecurity` untouched, preload frozen to `{ platform, version }`, `shell.openExternal` gated by `isSafeExternalUrl`, navigation/popup allowlist via `classifyUrl`, webviews blocked, no DevTools in production, packaged builds require an `https` `DESKTOP_APP_URL`.
6. **One slice per PR.** Do not mix a workflow change with an updater change, or either with product code. Run the full gate (`npm ci`, `npm test`, `npm run typecheck`, `npm run desktop:typecheck`, `npm run lint`, `npm run build`, `npm run desktop:compile`) before calling a slice done. `desktop:dist:win` / the release workflow is the acceptance run for signing and publish slices.

## Target state (what "done" looks like)

- App binaries **and** the NSIS installer are signed with a valid Windows code-signing certificate (EV / cloud HSM preferred).
- A tagged release publishes `TitleIX-Policy-Tracker-Setup-x.y.z.exe` **plus** `latest.yml` and checksums, via a real GitHub `generic` (or `github`) publish config.
- Installed app checks for updates in the background on startup → silent download → user notification → restart & install, with strict signature verification and `electron-log` for diagnostics.
- A clean Windows 11 VM (standard, non-admin user) passes the full lifecycle test below.
- `desktop:dist:win` no longer crashes at `computeChannelNames` — the publish config resolves.

## The build, in slices (do these in order)

Each slice is its own PR. Slices A and B are independent of C and can run in parallel once their prerequisites are met; C depends on A (signing) and B (a published update feed).

### Slice A — Code signing (`WP-15A` Deferred Item 1)

Branch: `desktop/phase2-signing-updates` (per the workplan's Phase 2 workflow) or a slice-specific branch off it.

- Sign both the application binaries and the NSIS installer with a valid Windows code-signing certificate (EV / cloud HSM preferred).
- Wire it through **CI environment variables / secrets only**: `win.certificateFile` / `win.certificatePassword` in `electron-builder.yml`, or `signtool` invoked from CI. Whatever mechanism is chosen, the certificate and password must come from GitHub Actions secrets (e.g. a base64 `.pfx` written to a temp path in the job, or a cloud-HSM signing step), never from the repo.
- Also fix the publish-config gap here **if** signing is coupled to it: add the real `repository` field to `package.json` and a `publish: { provider: "generic", url: <update feed URL>, channel: "latest" }` block to `electron-builder.yml` so `computeChannelNames` resolves. (If the maintainer prefers, this publish-config fix can be its own tiny slice before B — but it must land before B or the release feed won't generate.)
- **Acceptance:** `desktop:dist:win` in CI produces a signed `TitleIX-Policy-Tracker-Setup-<version>.exe`; `signtool verify /pa` (or equivalent) passes on the installer and the inner exe; no `computeChannelNames` crash; `git log`/`git status` show zero certificate material.

### Slice B — Release pipeline (`WP-15B` Deferred Item 3)

Branch: `desktop/phase2-ci-pipeline`.

New GitHub Actions release workflow under `.github/workflows/` (do not overload `ci.yml` — keep PR CI and release separate). Recommended Windows runner (`windows-latest`) pipeline, in this order:

```
checkout → npm ci → prisma generate → lint → typecheck (both configs)
→ unit tests → next build → desktop:compile → electron-builder
→ sign artifacts → archive installer (+ latest.yml, checksums)
```

- "Typecheck (both configs)" = `npm run typecheck` (web) **and** `npm run desktop:typecheck` (Electron).
- Trigger on **tagged releases** (e.g. `v*`). Tagged releases publish `TitleIX-Policy-Tracker-Setup-x.y.z.exe` (matches the existing `artifactName`).
- `sign artifacts` consumes Slice A's secrets; if Slice A is not merged yet, gate the sign step so the workflow still builds and the sign step is a clearly-marked no-op TODO (never a fake "signed" claim).
- Archive alongside the installer: `latest.yml` (electron-builder's update metadata) and checksums (SHA-256).
- **Acceptance:** pushing a tag produces a GitHub release with the installer + `latest.yml` + checksums; the run is green end to end; the published installer passes signature verification.

### Slice C — Automatic updates (`WP-15A` Deferred Item 2)

Branch: `desktop/phase2-signing-updates` (same workplan as A) or a dedicated `desktop/phase2-auto-updates`.

- **Ship install → launch → authenticate → operate → uninstall first in v1.** Phase 1 already did; this slice must not regress that flow.
- Integrate `electron-updater` and `electron-log` (both new dependencies — this is a dependency-manifest change, so `npm ci`/lockfile work belongs in this slice).
- Flow: **background check on startup → silent download → user notification → restart & install.**
- Updates **must strictly verify signatures** to prevent binary tampering. Point the updater at the Slice B update feed (`latest.yml`); fail closed if the signature or feed is invalid.
- Keep the preload surface frozen (`{ platform, version }`); update logic lives in the **main process** only — no IPC bridge growth, no renderer-driven update control beyond what `electron-updater`'s safe main-process API already exposes. Reuse `electron/log` for diagnostics rather than ad-hoc `console` logging.
- **Acceptance:** a new tag's installer updates an already-installed older build (silent download → prompt → restart & install) with signature verification enforced; a tampered/corrupt feed is rejected; `electron/main.ts` stays well under 1000 lines (extract an `electron/updater.ts` module rather than growing `main.ts`).

### Slice D — Clean-VM lifecycle test (`WP-15B` Deferred Item 4)

Branch: `desktop/phase2-vm-lifecycle` (or fold the report into the Slice B PR if the maintainer prefers — but the test run must happen after a real published installer exists).

- Run on a **fresh Windows 11 VM** as a **standard (non-admin) user**.
- Lifecycle to exercise and record with pass/fail + evidence (mirror the WP-14 audit's table style):
  **download → install → Start Menu launch → desktop shortcut → authenticate → close → reopen (session persistence) → upgrade → uninstall.**
- This supersedes the WP-14 functional-smoke items that were left `PENDING-ENV` in `docs/DESKTOP-AUDIT.md`; the report should explicitly close those out (or keep them PENDING with a reason).
- Note the recorded uninstall decision from WP-14: uninstall removes program files but **leaves `userData`** (window bounds, session) so a reinstall preserves state. Confirm, don't silently "fix", that behavior.
- **Deliverable:** a dated report under `docs/` in the WP-14 style (e.g. `docs/DESKTOP-VM-LIFECYCLE.md`) with the lifecycle table, evidence, and an overall verdict. Nothing in this slice changes app code unless the test finds a real defect (then fix in a separate PR).

## Phase 2 git & PR workflow (from the workplans)

For the signing/updates workplan (Slices A + C):

```bash
git checkout -b desktop/phase2-signing-updates
git commit -m "feat(desktop): phase 2 code signing and auto updates"
gh pr create --base main --head desktop/phase2-signing-updates --title "feat(desktop): Phase 2 Code Signing & Updates" --body "Implements Windows code signing and background update checks."
```

For the CI/CD pipeline workplan (Slices B + D):

```bash
git checkout -b desktop/phase2-ci-pipeline
git commit -m "ci(desktop): add Windows electron-builder release workflow"   # workflows under .github/workflows/
gh pr create --base main --head desktop/phase2-ci-pipeline --title "ci(desktop): Windows Release Pipeline" --body "Adds GitHub Actions release workflow for building and packaging the Windows desktop shell."
```

## Acceptance criteria (whole Phase 2)

- [ ] App binaries and NSIS installer signed with a valid Windows cert (EV / cloud HSM preferred); signing material only ever in CI secrets, never in Git.
- [ ] Tagged release publishes `TitleIX-Policy-Tracker-Setup-x.y.z.exe` + `latest.yml` + checksums.
- [ ] Auto-update: startup background check → silent download → notification → restart & install, with strict signature verification and `electron-log` diagnostics.
- [ ] `desktop:dist:win` / release build no longer hits the `computeChannelNames` null-channel crash (real `repository` + `publish` config).
- [ ] Clean Windows 11 VM (non-admin) lifecycle report exists and records download → install → launch → shortcut → authenticate → close → reopen → upgrade → uninstall.
- [ ] WP-14 security posture unchanged (no secret in asar; sandbox/contextIsolation/webSecurity/allowlist/https rules intact).
- [ ] No test weakened to make any of the above pass; every slice passes the full gate before merge.

## Decisions the maintainer must make before/during the build

1. **Signing certificate:** EV cert, or cloud HSM signing service? Who provisions it and how does CI reach it? (Blocks Slice A and the `sign artifacts` stage of Slice B.)
2. **Update feed URL / release channel:** where `latest.yml` is hosted (GitHub Releases `generic` feed is the default assumption) and whether there is more than one channel. (Blocks the `publish:` config in A/B and Slice C.)
3. **PR shape:** does each slice get its own PR (recommended, per `docs/ORCHESTRATOR.md`), or should Slices A+C share the `desktop/phase2-signing-updates` PR and B+D share `desktop/phase2-ci-pipeline` as the workplan snippets suggest? (The snippets imply one PR per workplan; the quality bar suggests one per slice. Pick one and be consistent.)
4. **Slice D report location/style:** confirm the WP-14-style dated `docs/*.md` report is the right deliverable.

## How to run this in the next session

1. Read, in order: `desktop-workplans/00-PROJECT-CONTEXT.md` (if available), `docs/DESKTOP-AUDIT.md`, `docs/DESKTOP-SIGNING-UPDATES.md`, `docs/DESKTOP-RELEASE-PIPELINE.md`, `docs/ORCHESTRATOR.md`, this file.
2. Confirm the maintainer decisions above (especially signing + update-feed) before writing any code — Slice A and B's sign step are blocked without them.
3. Work the slices in order **A → B → C → D** (A and B may parallelize after the publish-config fix; C needs A and B; D needs B's published installer).
4. One PR per slice (or per workplan, per decision 3). Run the full gate before each merge. Do not weaken tests. Do not commit secrets.
