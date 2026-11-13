# Standalone Desktop Architecture — Linux, AppImage, Local Mode & Rust Shell

## Goals & Shipping Sequence

1. **Linux support** across **Arch** (`pacman` + `packaging/arch/PKGBUILD`), **Ubuntu** (`deb`), and **Fedora** (`rpm`).
2. **Downloadable AppImage** (`TitleIX-Policy-Tracker-<version>-linux-x64.AppImage`).
3. **Standalone local desktop app**: no external browser, no TCP port (`0` listening TCP sockets), and no hosted server — powered by embedded **PGlite** + checked-in Prisma migrations over a `0700` Unix domain socket (`$XDG_RUNTIME_DIR/titleix-policy-tracker/app.sock`).
4. **Rust / Tauri v2 shell** (`src-tauri/`): 1-to-1 port of the Electron shell behind a measured promotion gate (`npm run desktop:gate`).

The hosted web application (Next.js + PostgreSQL + Google OAuth) remains completely intact alongside local desktop mode.

---

## Architecture Overview

```
 shell (Electron in electron/, Rust/Tauri in src-tauri/)
 ├─ window, menu, navigation lockdown, single-instance lock
 ├─ custom scheme  app://tracker/…  ──►  HTTP/1.1 over Unix domain socket
 │                                       $XDG_RUNTIME_DIR/titleix-policy-tracker/app.sock (dir 0700, sock 0600)
 ├─ injects local Auth.js session cookie on every forwarded request
 └─ reads ingest API keys from OS keyring (org.titleixpolicytracker.desktop), passes as env at spawn

 local server process (Node / ELECTRON_RUN_AS_NODE)
 ├─ Next.js standalone production build, unchanged RSC pages and API routes
 ├─ Prisma ──► PGlite (embedded Postgres WASM) in $XDG_DATA_HOME/titleix-policy-tracker/pgdata (0700)
 └─ applies checked-in prisma/migrations on startup, seeds corpus on first run
```

### Why pages and API routes remain unchanged

On startup, `bootstrapLocalPGlite` (`src/lib/local-runtime/pglite-bootstrap.ts`) applies all checked-in `prisma/migrations/*/migration.sql` files, seeds the 52 jurisdictions + 8 issue tags + reviewed fixture corpus on first run, and upserts a single local `ADMIN` user + `Session` row matching the shell's per-launch 256-bit `TITLEIX_SESSION_TOKEN`. Because the shell injects `Cookie: authjs.session-token=<token>` on every request forwarded over `app.sock`, `src/middleware.ts`, `src/lib/auth.ts`, `src/lib/auth-guards.ts`, and every RSC page and API route authenticate without any mode-specific branches. The one exception is sign-in and sign-out: deleting that session row would lock the user out until the next launch, so when `isLocalMode()` (`src/lib/local-mode.ts`, `TITLEIX_LOCAL_MODE === "1"`) is true the header shows a "Local mode" badge instead of a sign-out button, `/sign-in` redirects to `/`, and the `signOutAction` and `signInWithGoogle` server actions (`src/app/auth-actions.ts`) return without doing anything.

---

## Supplying Ingest API Keys via OS Keyring (Arch, Ubuntu, Fedora)

Store optional legislative ingest keys in your system keyring (GNOME Keyring, KWallet, or KeePassXC Secret Service) using `libsecret` (`secret-tool`):

```bash
# Install libsecret CLI if not already present:
#   Arch:   sudo pacman -S libsecret
#   Ubuntu: sudo apt install libsecret-tools
#   Fedora: sudo dnf install libsecret

secret-tool store --label="Title IX Congress.gov Key" \
  service org.titleixpolicytracker.desktop username CONGRESS_GOV_API_KEY

secret-tool store --label="Title IX OpenStates Key" \
  service org.titleixpolicytracker.desktop username OPEN_STATES_API_KEY

secret-tool store --label="Title IX LegiScan Key" \
  service org.titleixpolicytracker.desktop username LEGISCAN_API_KEY
```

Both the Electron shell (`electron/keyring.ts`) and the Rust/Tauri shell (`src-tauri/src/keyring_env.rs`) read these exact Secret Service attributes at launch and pass them to the local server child process environment.

---

## Building & Running on Linux

```bash
# Generate 512x512 Linux & Tauri icons
npm run desktop:icons

# Build downloadable AppImage (Electron shell, zero host Node dependency)
npm run desktop:dist:appimage

# Build AppImage + Arch (.pacman) + Ubuntu (.deb) + Fedora (.rpm)
npm run desktop:dist:linux

# Build & test the Rust / Tauri v2 shell (requires Rust toolchain + webkit2gtk-4.1 + libsecret)
(cd src-tauri && cargo test)
npm run tauri:build

# Evaluate Milestone 3 measured shell gate (size ratio, startup latency, idle RSS)
npm run desktop:gate
```
