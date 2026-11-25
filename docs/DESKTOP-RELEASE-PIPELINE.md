# WP-15B & WP-16 — Desktop Release Pipeline & Local Bundled Runtime

Context: see [`docs/DESKTOP-LOCAL-AND-RUST.md`](./DESKTOP-LOCAL-AND-RUST.md) and [`electron/README.md`](../electron/README.md).

## Deferred Item 3 — CI/CD release pipeline (Linux + Windows)

Linux packaging and verification run in [`.github/workflows/desktop-linux.yml`](../.github/workflows/desktop-linux.yml):

```
checkout → npm ci → prisma generate → lint → typecheck (web + desktop)
→ vitest → next build → stage-local-bundle → desktop:compile → electron-builder
→ verify-desktop-pack → packaged-app smoke → secret-free bundle audit
→ upload AppImage + pacman + deb + rpm
```

A parallel job compiles and tests (`cargo test`) the Rust/Tauri v2 shell in `src-tauri/` and builds its AppImage, `.deb`, and `.rpm` artifacts. That shell is Linux-only — see [DESKTOP-SHELLS.md](./DESKTOP-SHELLS.md).

Windows packaging has two entry points:

- [`.github/workflows/desktop-windows.yml`](../.github/workflows/desktop-windows.yml) — on every push/PR. Builds the real (unsigned) NSIS installer, runs the packaging contract and the packaged-app smoke, and uploads the installer as a workflow artifact so a stranger can install without waiting for a signed release.
- [`.github/workflows/release.yml`](../.github/workflows/release.yml) on `windows-latest`, for `v*` tags and for `workflow_dispatch` (`dry_run: true` builds and verifies without publishing):

```
checkout → npm ci → prisma generate → lint → typecheck (web + desktop)
→ vitest → next build → stage-local-bundle → desktop:compile → electron-builder (NSIS)
→ [signature check, when signed] → verify-desktop-pack → packaged-app smoke
→ checksums → upload artifacts → [publish, signed tag pushes only]
```

### One desktop model: standalone local app

The Windows installer ships the same standalone local app as the Linux packages. There is no hosted site to point a thin client at, and the build has no app URL setting.

- **No build-time URL.** `release.yml` does not set `DESKTOP_APP_URL`; nothing in the build reads it. A packaged app always starts in local mode (`app://tracker`).
- **`DESKTOP_APP_URL` is a runtime override only.** `resolveAppUrl` in `electron/constants.ts` reads it from the *user's* environment at launch. Unset (the normal case) means local mode; set, it must be `https://` or the app shows the "Configuration Error" card. It is never baked into a package.
- **`local-bundle/` must be staged before packaging.** `npm run desktop:stage-local` copies the Next.js standalone build, migrations, fixtures and PGlite into `local-bundle/` and writes `local-bundle/local-server-entry.cjs`. `electron-builder.yml` `extraResources` copies it to `resources/local-bundle` on every platform, with `local-bundle/node_modules` as a separate entry because electron-builder always drops a `node_modules` folder at the root of a copy source. Without it, every launch ends on the "Local Database Startup Error" card.
- **Windows uses a named pipe, not a Unix socket.** `electron/local-runtime.ts` picks `\\.\pipe\titleix-policy-tracker-<user>` and `%APPDATA%\titleix-policy-tracker` for data. The generated `local-server-entry.cjs` skips every `chmod`/`unlink`/stale-socket probe on `win32`, because none of them apply to a pipe.

### Release gates for the local bundle

- **`scripts/verify-desktop-pack.mjs [unpackedDir]`** (`npm run desktop:verify-pack`) checks the unpacked output (default `dist-desktop/win-unpacked` on Windows, `dist-desktop/linux-unpacked` elsewhere; also `DESKTOP_UNPACKED_DIR`). It fails if:
  - the electron-updater closure is missing from `app.asar`;
  - `app.asar` contains server code (Next.js, React, Prisma, next-auth) or secret names (`DATABASE_URL`, `AUTH_SECRET`, ingest API keys) — these rules apply to `app.asar` only, because `resources/local-bundle` legitimately contains Next.js and Prisma;
  - the packed entry point is not `electron-dist/main.js`;
  - `resources/local-bundle/local-server-entry.cjs`, `resources/local-bundle/.next/required-server-files.json`, or the bundle's `node_modules/next` / `node_modules/@prisma/client` is missing.
- **Packaged-app smoke** (`npm run desktop:smoke`, `scripts/smoke-local-server.mjs`): runs the packaged executable as Node (`ELECTRON_RUN_AS_NODE=1`) with a temporary `TITLEIX_DATA_DIR`, a per-run endpoint (`\\.\pipe\titleix-smoke-…` on Windows, a temp `.sock` on Linux) and no `DATABASE_URL`, waits for the server to print `READY`, then performs an authenticated `GET /` **over that endpoint** and fails unless the response is HTTP 200 and contains the rendered app. This runs on Linux (`desktop-linux.yml`), on Windows (`desktop-windows.yml`, `release.yml`) and is covered by `scripts/smoke-local-server.test.ts`. The earlier PowerShell smoke only checked for `READY`; a request to that server without `AUTH_SECRET` returns HTTP 500, so the request assertion is what actually protects a first launch.

## Deferred Item 4 — Clean-VM / distro lifecycle verification

- **Linux targets**: Arch (`pacman` / `PKGBUILD`), Ubuntu (`deb`), Fedora (`rpm`), and universal downloadable `AppImage`.
- **Windows target**: NSIS installer (`TitleIX-Policy-Tracker-<version>-win-x64.exe`).
- Lifecycle: install or `chmod +x *.AppImage` → launch offline with no TCP port open (`ss -tlnp` shows zero app listeners) → browse seeded corpus → edit cell notes & triage instruments → restart and confirm persistence in `$XDG_DATA_HOME/titleix-policy-tracker/pgdata`.

## WP-16 — Reversal of Deferred Item 5 (Standalone Local Mode Approved, 2026-11-11)

> **Historical note (Deferred Item 5, originally rejected for v1):** Packaging a hosted Next.js server with embedded `DATABASE_URL` and shared API keys would leak credentials inside `app.asar`.
>
> **WP-16 Decision (2026-11-11):** Reversed for **standalone local mode**. Local mode bundles the Next.js standalone server (`local-bundle/`) and embedded **PGlite** WASM runtime, shipping **zero secrets**:
> 1. Database state lives exclusively on the user's disk under `$XDG_DATA_HOME/titleix-policy-tracker/pgdata` (`0700`), initialized from checked-in `prisma/migrations` and `prisma/fixtures/demo-corpus.json`.
> 2. No Google OAuth credentials ship; the shell provisions a single local `ADMIN` session and injects the per-launch session cookie over a `0700`-scoped Unix domain socket (`$XDG_RUNTIME_DIR/titleix-policy-tracker/app.sock`).
> 3. Optional ingest API keys (`CONGRESS_GOV_API_KEY`, `OPEN_STATES_API_KEY`, `LEGISCAN_API_KEY`) are supplied by the user in their OS keyring (`org.titleixpolicytracker.desktop`) and passed via child environment at spawn.
> 4. Both `electron-builder.yml` and `scripts/stage-local-bundle.ts` continue to exclude all `.env*` files.
