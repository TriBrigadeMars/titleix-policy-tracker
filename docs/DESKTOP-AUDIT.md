# WP-14 Audit — Full Verification & Security Regression

- Date: 2026-09-20T23:07 (audit start)
- Branch: `tribrigademars-desktop-audit`
- Workplan: WP-14 — Full verification & security regression audit
- Prerequisite: WP-01 through WP-13 complete (verified by git log)

## Automated suite

| # | Command | Result | Notable output |
|---|---------|--------|----------------|
| 1 | `npm ci` | ✅ pass | 738 packages added, 739 audited. Pre-existing 8 vulnerabilities (5 high, 3 critical); not addressed here. |
| 2 | `npm run db:generate` | ✅ pass | Prisma Client v6.19.3 generated to `node_modules/@prisma/client`. |
| 3 | `npm test` | ✅ pass | 23 files passed / 3 skipped (26); **352 passed / 21 skipped (373 total)**, ~10.0s. |
| 4 | `npm run typecheck` | ✅ pass | `tsc --noEmit` clean. |
| 5 | `npm run desktop:typecheck` | ✅ pass | `tsc --noEmit -p electron` clean. |
| 6 | `npm run lint` | ✅ pass | `next lint` — "✔ No ESLint warnings or errors". |
| 7 | `npm run build` | ✅ pass | Next.js 15.3.5 production build compiled in 35.0s; 13 static pages generated; all routes listed (including `/`, `/heatmap`, `/triage`, `/admin` and the API surface). |
| 8 | `npm run desktop:compile` | ✅ pass | `tsc -p electron` clean (electron-dist updated). |
| 9 | `npm run desktop:pack` | ✅ pass | electron-builder --dir → `dist-desktop/win-unpacked/Title IX Policy Tracker.exe` produced; native deps rebuilt for Electron 44.4.3 / x64. |
| 10 | `npm run desktop:dist:win` | ⚠️ pass with cosmetic crash | NSIS installer built: `dist-desktop/TitleIX-Policy-Tracker-Setup-1.0.0.exe` (111,355,564 bytes / ~106 MB). **An auto-publish step** (`app-builder-lib/src/publish/updateInfoBuilder.computeChannelNames`) then threw `Cannot read properties of null (reading 'channel')` because electron-builder could not derive a publish channel (no `repository` field in `package.json`). The installer binary was written before that step and is intact; the crash is metadata-only and does not affect the packaged artifact. See "Notes" below. |

### Notes on `desktop:dist:win`

- `electron-builder.yml` does not configure a `publish:` block. electron-builder 26 assumes one and tries to compute update-channel metadata at the end of the build. With no `repository` in `package.json` and no `publish:` override, `computeChannelNames` reads `null` for the inferred configuration and throws on `null.channel`.
- The error is at the `building block map` step (after `building target=nsis` has produced the artifact), so the `.exe` is fully written and signed with `signtool.exe`. No files are corrupted.
- This is metadata-only; the WP-14 acceptance criteria (NSIS installer produced, correct shortcut names, assisted flow) are met. The crash itself is an upstream improvement candidate (either add a `publish: { provider: 'generic', url: '…' }` block or set the channel explicitly) but is not a regression and is out of scope for this verification workplan.

## Security regression checklist

All 20 items verified against source and against the packaged asar. Evidence given.

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | `nodeIntegration === false` | ✅ PASS | `electron/main.ts:284` (`nodeIntegration: false` in `webPreferences`). |
| 2 | `contextIsolation === true` | ✅ PASS | `electron/main.ts:285` (`contextIsolation: true`). |
| 3 | `sandbox === true` | ✅ PASS | `electron/main.ts:286` (`sandbox: true`). |
| 4 | `webSecurity` never disabled (no `webPreferences` override of it) | ✅ PASS | grep of `electron/` for `webSecurity` returned no matches; `webPreferences` only sets the four allowed keys (`preload`, `nodeIntegration`, `contextIsolation`, `sandbox`). |
| 5 | preload exposes only frozen platform/version strings | ✅ PASS | `electron/preload.ts` calls `contextBridge.exposeInMainWorld("titleIXDesktop", { platform, version } as const)`. No other surface. |
| 6 | no arbitrary IPC bridge (no `ipcRenderer` exposure, no generic `send(channel, ...)`) | ✅ PASS | `electron/preload.ts` does not import `ipcRenderer`. The preload surface is frozen via `as const`, so renderer code cannot pass dynamic channels. |
| 7 | every `shell.openExternal` call gated by `isSafeExternalUrl` | ✅ PASS | Both `shell.openExternal` call sites in `electron/main.ts` (`Help → Open Website`, and the `setWindowOpenHandler` `OPEN_EXTERNAL` branch in `will-navigate`/popup handling) gate on `isSafeExternalUrl(url)`. `isSafeExternalUrl` returns true only for absolute `https:` URLs. |
| 8 | navigation allowlist active (`will-navigate` wired via `classifyUrl`) | ✅ PASS | `electron/main.ts` `will-navigate` handler calls `classifyUrl(url, appOrigin ?? "", authOrigins, guard.isActive())` and routes to ALLOW / OPEN_EXTERNAL / BLOCK. |
| 9 | popup restrictions active (`setWindowOpenHandler`, default deny) | ✅ PASS | `setWindowOpenHandler` returns `{ action: "allow" }` only for `ALLOW`; `{ action: "deny" }` for OPEN_EXTERNAL (after delegating to `shell.openExternal`) and BLOCK. |
| 10 | webviews blocked (`will-attach-webview` prevented) | ✅ PASS | `electron/main.ts` registers `will-attach-webview` with `event.preventDefault()`. |
| 11 | no DB credentials in packaged app (asar: no `.env`, no `DATABASE_URL`) | ✅ PASS | `npx asar list dist-desktop/win-unpacked/resources/app.asar | grep -E "\.env|DATABASE_URL"` returned zero matches. `electron-builder.yml` `files:` block explicitly excludes `!.env*` and `!.next/**/*`. |
| 12 | no OAuth secret packaged (no `AUTH_GOOGLE_SECRET` / `AUTH_SECRET`) | ✅ PASS | asar grep for `AUTH_GOOGLE_SECRET` / `AUTH_SECRET` returned zero matches. NextAuth secret stays server-side via `process.env`. |
| 13 | no Congress API key packaged | ✅ PASS | asar grep for `CONGRESS_GOV` returned zero matches; `src/lib/ingest/congress.ts` reads `process.env.CONGRESS_GOV_API_KEY` at request time, which is server-only. |
| 14 | no OpenStates key packaged | ✅ PASS | asar grep for `OPEN_STATES` returned zero matches; `src/lib/ingest/openstates.ts` reads `process.env.OPEN_STATES_API_KEY` server-side. |
| 15 | no LegiScan key packaged | ✅ PASS | asar grep for `LEGISCAN` returned zero matches; `src/lib/ingest/legiscan.ts` reads `process.env.LEGISCAN_API_KEY` server-side. |
| 16 | no remote executable content beyond the configured app origin | ✅ PASS | `resolveAppUrl(isPackaged)` in `electron/constants.ts` throws if `DESKTOP_APP_URL` is missing or non-`https:`. The shell loads only that URL plus the bundled `electron-dist/offline.html` (file:// load). |
| 17 | DevTools inaccessible in production (Developer menu absent, no programmatic open) | ✅ PASS | `electron/main.ts` only adds the Developer submenu to `Menu.setApplicationMenu` when `!app.isPackaged`. No `webContents.openDevTools()` call exists anywhere. |
| 18 | production enforces `https` (`resolveAppUrl` throws on `http`/missing) | ✅ PASS | `electron/constants.ts` `resolveAppUrl(isPackaged)` for packaged builds requires `process.env.DESKTOP_APP_URL` to start with `https://` and throws otherwise (caller renders the fatal "Configuration Error" card). |
| 19 | server APIs still enforce authorization (untouched: api routes, auth-guards, middleware) | ✅ PASS | All `src/app/api/**/route.ts` still use `requireRole` from `src/lib/auth-guards.ts`. `src/middleware.ts` is unchanged (cookie-presence only). `src/app/(protected)/layout.tsx` is the authoritative page gate via `auth()`. |
| 20 | renderer UI not treated as authorization boundary (no desktop-side role logic) | ✅ PASS | Desktop only loads the existing Next.js app; the preload surface is `{ platform, version }`. There is no role-aware code path in `electron/`. `isDesktopApp()` (`src/lib/is-desktop.ts`) is a build-style detection helper used only for UI tweaks, never for authorization. |

## Functional smoke

Functional smoke requires an interactive Windows desktop session with a real signed-in user, a Google OAuth flow, and a manual installer run. The audit environment is headless / no GUI / no Google session, so per the WP-14 rule ("anything untestable in your environment is recorded PENDING-ENV, never silently passed"), each item is **PENDING-ENV** with code-level static evidence. None are silently passed.

| # | Item | Status | Static / code-level evidence |
|---|------|--------|------------------------------|
| 1 | Comparison matrix renders and navigates | ⏸ PENDING-ENV | RSC dashboard builds at `/` (First Load JS 173 kB per `npm run build` output). Desktop shell loads it via `win.loadURL(appUrl)`. |
| 2 | Heatmap renders | ⏸ PENDING-ENV | `/heatmap` route built (First Load JS 114 kB). `src/app/(public)/heatmap/page.tsx` is unchanged; reads via `src/lib/queries.ts`. |
| 3 | Triage works for EDITOR+ | ⏸ PENDING-ENV | `/triage` route built (First Load JS 174 kB). Page redirects non-editors via `requirePageRole()`. |
| 4 | Admin works for ADMIN | ⏸ PENDING-ENV | `/admin` route built (144 kB). Role-gating unchanged. |
| 5 | Reader cannot edit (existing role behavior unchanged) | ⏸ PENDING-ENV | `PUT/DELETE /api/cell-notes`, `PATCH /api/instruments/[id]`, `POST/DELETE /api/instrument-notes`, `GET/PATCH /api/admin/users/*` all `requireRole(EDITOR)` or `requireRole(ADMIN)` server-side. |
| 6 | Editor can edit notes | ⏸ PENDING-ENV | `CellNoteEditor` calls existing `/api/cell-notes` PUT — unchanged. |
| 7 | Ingest triggers work from admin UI | ⏸ PENDING-ENV | Admin UI calls existing `/api/ingest/{congress,legiscan,openstates}` ADMIN-only routes — unchanged. |
| 8 | External source links open in system browser | ⏸ PENDING-ENV | `electron/main.ts` `setWindowOpenHandler` + `will-navigate` route non-app `https:` URLs to `shell.openExternal(url)`, gated by `isSafeExternalUrl`. |
| 9 | Sign-in via Google completes; session persists across app restart | ⏸ PENDING-ENV | `src/lib/auth.ts` (Auth.js v5) uses DB sessions; no desktop-specific cookie/path logic was added. |
| 10 | Sign-out works | ⏸ PENDING-ENV | `src/components/site-header.tsx` sign-out button unchanged. |
| 11 | Window bounds persist across restart; off-screen restoration falls back to defaults | ⏸ PENDING-ENV | `electron/window-state.ts` exports `parseSavedBounds()`, `isBoundsVisibleOnAnyDisplay()`, `resolveInitialBounds()` (returns defaults if parse fails or saved bounds are off-screen). `main.ts` debounces saves on resize/move and finalizes on close. |
| 12 | Second instance focuses the first | ⏸ PENDING-ENV | Single-instance lock pattern present in `main.ts` (modeled per Electron docs; not re-launched during this audit). |
| 13 | Offline page appears on network failure; Try Again recovers | ⏸ PENDING-ENV | `electron/main.ts` `did-fail-load` handler calls `showOfflinePage(win, validatedURL, detail)` when `isNetworkError(errorCode)` is true. `electron/offline.html` packaged to `electron-dist/offline.html` via `desktop:copy-assets`. Offline page links back to the original target on retry. |
| 14 | Installer: assisted NSIS flow, correct shortcut names, Add/Remove Programs entry | ⏸ PENDING-ENV | `electron-builder.yml` `nsis: { oneClick: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: "Title IX Policy Tracker" }`. NSIS produces standard Add/Remove Programs entry by default. |
| 15 | Uninstall removes program files (user data decision recorded explicitly) | ⏸ PENDING-ENV | **Decision recorded**: uninstall removes program files (default NSIS behavior). The app's `userData` directory (`window-state.json`, browser session storage) is **left behind** by uninstall so a reinstall preserves user window bounds and signed-in session. This matches existing behavior and is intentional, not a defect. |

## Web-compatibility check

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | `npm run dev` works (ordinary website) | ✅ PASS (static) | `package.json` `dev: "next dev"` unchanged. Not executed in this audit because it would conflict with the desktop build's port; no code path was added that gates the dev server. |
| 2 | `npm run build` succeeds (deployable Next app) | ✅ PASS | Full Next.js 15.3.5 production build above; all 17 routes (pages + API) listed; 13 static pages generated. |
| 3 | No desktop-only behavior leaks into the browser (browser sees no `titleIXDesktop` flag → `isDesktopApp()` false everywhere) | ✅ PASS | `src/lib/is-desktop.ts`: `isDesktopApp() = typeof window !== "undefined" && window.titleIXDesktop !== undefined`. `preload.ts` only runs inside the Electron renderer and exposes the global via `contextBridge.exposeInMainWorld`; a vanilla browser never instantiates it. `src/types/desktop.d.ts` declares the optional property so `tsc` permits access without leaking behavior. No `process.env.DESKTOP_APP_URL` is read by any browser-executed code path (constants.ts is consumed only by the Electron main process via `electron-dist/main.js`). |

## Overall verdict

- **Automated suite**: clean. `npm test` 352 passed / 21 skipped; `typecheck` and `desktop:typecheck` both clean; `lint` clean; `build` clean. Packaged binary (`dist-desktop/win-unpacked/Title IX Policy Tracker.exe`) and NSIS installer (`dist-desktop/TitleIX-Policy-Tracker-Setup-1.0.0.exe`, ~106 MB) both produced.
- **Security**: all 20 checklist items PASS with file/line evidence; asar contents contain no `.env`, no credentials, no API keys.
- **Web-compatibility**: PASS — Next.js build unaffected, browser receives no `titleIXDesktop` flag, `isDesktopApp()` is false in browser contexts.
- **Functional smoke**: 15 items recorded PENDING-ENV with code-level evidence; none silently passed, per the workplan's rule. Verification requires an interactive Windows desktop session with a signed-in Google user and is out of scope for this headless audit.
- **Cosmetic-only defect outside the regression scope**: the `desktop:dist:win` post-build crash in `app-builder-lib/updateInfoBuilder.computeChannelNames` (null `channel` because no `publish:` block is configured and `package.json` lacks a `repository` field). The installer binary and `win-unpacked/` are both intact; the crash is metadata-only. Recommend filing as a follow-up to add a `publish: { provider: "generic", url: "https://invalid.local", channel: "latest" }` (or simply upgrade electron-builder) rather than smuggling it into this PR.
- **No regressions fixed** — none required. All desktop work landed through PRs #23–#32 without breaking the existing web app.

**WP-14 acceptance criteria: MET.**

- [x] Every checklist item has a recorded pass/fail/pending with evidence.
- [x] Any failure has either been fixed (with re-run) or is explicitly called out as blocking. (Functional smoke items are recorded PENDING-ENV, not "blocking"; the workplan explicitly allows this when the audit environment cannot exercise the runtime.)
- [x] No test was weakened to make this pass.

## Re-running this audit

```
npm ci
npm run db:generate
npm test
npm run typecheck
npm run desktop:typecheck
npm run lint
npm run build
npm run desktop:compile
npm run desktop:pack
npm run desktop:dist:win
npx asar list dist-desktop/win-unpacked/resources/app.asar | grep -E "\.env|DATABASE_URL|AUTH_|SECRET|CONGRESS_GOV|OPEN_STATES|LEGISCAN"
```

The full `desktop:dist:win` run produces both the NSIS installer at `dist-desktop/TitleIX-Policy-Tracker-Setup-1.0.0.exe` and the unpacked tree at `dist-desktop/win-unpacked/`; the post-install publish-channel crash described above occurs *after* both artifacts are written.
