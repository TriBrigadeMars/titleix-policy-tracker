# titleix-platform — audit, comparison, plan

Lane: `swarm/platform` · worktree `~/Projects/tribrigade-swarm/lanes/titleix-platform`
Scope: install/run/packaging on Linux + Windows 11, CI matrix, setup docs, tests for those.
Out of scope: feature/UX work in `src/` (owned by `titleix-product`).

## 1. Audit — what actually works on Linux today

Environment: CachyOS Linux, Node 26.13.1 (repo requires >= 22), npm 12.2.2.

| Command | Result | Notes |
|---|---|---|
| `npm ci` | ✅ | 15 known advisories (pre-existing). `npm 12` blocks 6 install scripts unless approved; `npm run db:generate` still works, Electron binary must be fetched with `node node_modules/electron/install.js` on this host. CI npm does not block them. |
| `npm run db:generate` | ✅ | Prisma client 6.19.3. |
| `npm run typecheck` | ✅ | clean. |
| `npm run lint` | ✅ | `next lint` (deprecated in Next 16) — 0 warnings. |
| `npm test` | ✅ | 45 files / 603 tests passed, 29 skipped, 10.7 s. |
| `npm run build` | ✅ | Next 15.5.29 standalone, 13 routes, middleware 34.4 kB. |
| `npm run desktop:pack` | ✅ | `dist-desktop/linux-unpacked` (384 MB) via electron-builder 26.18.1. |
| `npm run desktop:verify-pack` | ✅ | updater closure (17 modules), no server code/secrets in asar, `electron-dist/main.js`, 4 required local-bundle files. |
| packaged local server (`ELECTRON_RUN_AS_NODE=1 <exe> resources/local-bundle/local-server-entry.cjs`) | ✅ | prints `READY <socket>`; socket is `srw-------`; data dir `0700`. |
| HTTP GET `/` over that socket with the local session cookie | ✅ | **HTTP 200, 86 152 bytes, contains “Title IX”** — the packaged DB seeds and Next.js serves. |
| GUI launch (`xvfb-run … linux-unpacked/titleix-policy-tracker`) | ✅ | window path spawns the same server; **HTTP 200, 64 505 bytes** over the shell’s socket. Screenshot captured for the report. |

Findings from the audit:

1. **Packaging is real and correct on Linux.** The concern in the brief (“does a no-Postgres offline mode work?”) is already implemented: PGlite + migrations + first-run seeding in `scripts/stage-local-bundle.ts`, spawned by `electron/local-runtime.ts`.
2. **Windows support is written but not proven in CI.** `electron-builder.yml` already has `win: nsis`, `build/icon.ico` has a 256 px entry, `electron/constants.ts`/`local-runtime.ts` handle `win32` (named pipe `\\.\pipe\…`, `%APPDATA%`), and `release.yml` builds the installer — but only for `v*` tags. **There is no `windows-latest` job on push/PR**, so a Windows regression is invisible until a release tag.
3. **The packaged-app smoke is PowerShell-only and shallow.** `release.yml` runs a ~100-line PowerShell block that starts the local server and waits for `READY`. It never makes an HTTP request, and it does not set `AUTH_SECRET`. I reproduced the hole: a request to that server returns **HTTP 500 “AUTH_SECRET is not set”**. The real Electron shell sets `AUTH_SECRET`, so users are fine — but CI would not catch a shell that stops doing so.
4. **The README has no end-user install path for either OS.** The only Windows quick start is a collapsed `<details>` block for *web dev*; the desktop section is titled “Standalone Linux Desktop & AppImage” with no Windows equivalent and no “download the installer” path. A stranger cannot tell what to download or where their data goes.
5. **Docs over-promise the Tauri shell’s portability.** `docs/DESKTOP-LOCAL-AND-RUST.md` says “Windows” in the same sentence as both shells. In code, `src-tauri/src/uds_proxy.rs` and `local_server.rs` forward over Unix sockets behind `#[cfg(unix)]`, `tauri.conf.json` bundles only `appimage/deb/rpm`, and no workflow builds Tauri on Windows. Tauri is a **Linux-only** shell today.
6. **Windows path logic has no unit tests.** `resolveShellSocketPath` / `resolveShellDataDir` in `electron/local-runtime.ts` and `src/lib/local-runtime/paths.ts` are `platform`-parameterised, so they can be asserted for `win32` on Linux, but no test does. The Windows claims rest on inspection only.
7. Minor: four `desktop:dist*` scripts repeat `build && stage-local && compile && copy-assets`; `release.yml` has to duplicate those steps inline because of npm arg forwarding, which invites drift.

Not blockers, recorded for honesty: `next lint` deprecation; 15 npm advisories pre-existing; `npm 12` install-script gating on this dev host.

## 2. Comparison — comparable open-source projects

| Project | What it is | Practices worth taking | Rejected / not applicable |
|---|---|---|---|
| [th-ch/youtube-music](https://github.com/th-ch/youtube-music) (Electron, ~10k★) | Cross-platform Electron desktop app built with a JS framework | OS **matrix CI** (`macos-26`, `ubuntu-latest`, `windows-latest`) with per-OS release steps; `xvfb` wrapper for Linux GUI tests; separate installer vs portable artifacts in release notes; winget submission | Its release pipeline is entangled with its own repo (`github.repository == …` guards) and signs/publishes from the matrix. Ours already has a signed-release workflow; we only need **PR-level** Windows proof. |
| [jellyfin/jellyfin-desktop](https://github.com/jellyfin/jellyfin-desktop) | Qt desktop client, shipping Linux/Windows/macOS | **“Downloads” first** in the README with per-OS links, including nightly/dev builds; an explicit **file-locations table per OS** (config/cache/logs) | It delegates builds to `dev/` per platform; we keep one documented `electron-builder` config. Qt/mpv stack irrelevant. |
| [lightningbolts/state-pulse](https://github.com/lightningbolts/state-pulse) | Closest domain peer: state legislation tracker (Next.js) | None for install UX — useful as a **negative** baseline: requires MongoDB + Clerk + OpenStates + Gemini keys before it runs at all | Its cloud-only, key-heavy “Getting Started” is exactly what our PGlite bundle avoids. Confirms the local-first desktop path is our differentiator. |
| [saltyshiomix/nextron](https://github.com/saltyshiomix/nextron) | Next.js + Electron boilerplate | Package layout: `main` entry in `package.json`, explicit app dir, single place for the Electron entry (`electron-dist/main.js`) — already matched here | Boilerplate has no local DB or update/security model; nothing to adopt beyond what exists. |
| [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) (docs) | The packager this repo already uses | NSIS assisted installer fields (`oneClick: false`, `allowToChangeInstallationDirectory`, shortcuts) — already configured; `deleteAppDataOnUninstall` as an explicit data-retention decision | No new packager/Forge migration: churn without user-visible benefit. |

**Conclusions taken into scope.** (a) prove Windows on every push, not only on tags; (b) make the packaged-app smoke request a real page on both OSes; (c) give the README a downloads-first install path plus per-OS data locations; (d) state plainly which shell ships on Windows.

## 3. Ranked improvements (impact × effort)

| # | Improvement | Impact | Effort | Verdict |
|---|---|---|---|---|
| 1 | `windows-latest` job in `ci.yml` (lint/typecheck/desktop typecheck/test/build) | High — catches Windows-only breaks on every PR | S | **Do** |
| 2 | `windows-latest` packaging workflow (NSIS + verify + smoke + artifact) | High — installable `.exe` from every push, not just signed tags | M | **Do** |
| 3 | Cross-platform `scripts/smoke-local-server.mjs` (`npm run desktop:smoke`): start packaged app as node, wait `READY`, **GET `/` with the local session cookie**, assert 200 + page content | High — turns “it starts” into “it serves the app”; works with UDS and named pipe; replaces 90 lines of PowerShell | M | **Do** |
| 4 | `docs/INSTALL.md` + README “Download & install” (Linux + Windows 11), per-OS data/upgrade/uninstall/troubleshooting | High — the actual stranger path | M | **Do** |
| 5 | Two-shell decision doc with code evidence; Tauri scoped as Linux-only experimental, Electron as the shipping shell on both OSes | Medium — removes a false promise; keeps tested code | S | **Do** |
| 6 | Win32 unit tests for socket/data/config resolution (both `electron/` and `src/lib/local-runtime/`) | Medium — Windows claims become executable assertions on Linux CI | S | **Do** |
| 7 | `desktop:prepare` script; dist scripts use it; smoke/verify wired into Linux CI | Low/Medium — kills four-way duplication and drift | S | **Do** |
| 8 | `nsis.deleteAppDataOnUninstall: false` + explain uninstall/data behaviour | Low — explicit user-data contract | XS | **Do** |
| 9 | Windows keyring lookup in the Electron shell (Credential Manager) | Low — ingest keys are optional; env vars already work on Windows | M | **Reject for now**: cannot execute Windows here, and untested PowerShell credential code is worse than a documented limitation. Documented in `docs/INSTALL.md`. |
| 10 | Delete the Tauri shell | Negative — it is CI-tested, gated, documented, and part of the repo’s value; not “clearly unused” | L | **Reject**; scope it instead. |
| 11 | Portable `.exe` target / MSI / winget publishing | Medium for distribution | M/L | **Reject** this pass: NSIS covers “install and run”; extra targets double build time and need signing. |

## 4. Chosen scope

1. Windows CI: `ci.yml` windows job + `desktop-windows.yml` packaging workflow.
2. `scripts/smoke-local-server.mjs` + npm script, used by Linux desktop CI, Windows packaging CI, and the release workflow.
3. `docs/INSTALL.md`, README downloads/install matrix, per-OS data paths.
4. `docs/DESKTOP-SHELLS.md` decision record + corrections to existing desktop docs.
5. Win32 unit tests; `desktop:prepare`; NSIS data-retention setting.

Windows itself cannot be executed on this Linux host. Everything Windows-specific is made platform-neutral Node, asserted by `win32`-parameterised unit tests, or exercised by the `windows-latest` job that lands with the branch. That limitation is stated in the final report.
