# WP-15B & WP-16 — Desktop Release Pipeline & Local Bundled Runtime

Context: see [`docs/DESKTOP-LOCAL-AND-RUST.md`](./DESKTOP-LOCAL-AND-RUST.md) and [`electron/README.md`](../electron/README.md).

## Deferred Item 3 — CI/CD release pipeline (Linux + Windows)

Linux packaging and verification run in [`.github/workflows/desktop-linux.yml`](../.github/workflows/desktop-linux.yml):

```
checkout → npm ci → prisma generate → lint → typecheck (web + desktop)
→ vitest → next build → stage-local-bundle → desktop:compile → electron-builder
→ secret-free bundle audit → upload AppImage + pacman + deb + rpm
```

A parallel job compiles and tests (`cargo test`) the Rust/Tauri v2 shell in `src-tauri/` and builds its AppImage, `.deb`, and `.rpm` artifacts.

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
