# Title IX Policy Tracker

Track proposed and passed laws impacting Title IX across the United States.

## Overview

A legislative and regulatory impact tracker for researchers, advocates, and journalists. Compare proposed or recently passed laws, regulations, and policies at the state and federal level that impact Title IX.

Runs in two modes from the same codebase:
- **Hosted web app**: Next.js 15 App Router + PostgreSQL + Google OAuth (`npm run dev` / `npm run build`).
- **Standalone desktop app** (Linux AppImage, Arch, Ubuntu, Fedora, Windows): embedded PGlite database in `$XDG_DATA_HOME/titleix-policy-tracker/`, custom `app://tracker` scheme over a `0700` Unix domain socket (`$XDG_RUNTIME_DIR/titleix-policy-tracker/app.sock`), single local user, no TCP port, no hosted server, and OS keyring ingest keys — with both Electron (`electron/`) and Rust/Tauri v2 (`src-tauri/`) shells.

## Quick Start (Linux & macOS — POSIX bash/zsh)

Requires **Node >= 22** (tested on Node 22 LTS through Node 26). For the hosted web mode with external PostgreSQL, **PostgreSQL 16+** is used in CI; without `DATABASE_URL`, the dev server automatically boots an embedded in-memory PGlite instance seeded with the demo corpus.

```bash
# Clone and enter the repository
git clone https://github.com/TriBrigadeMars/titleix-policy-tracker.git
cd titleix-policy-tracker

# Install dependencies
npm ci

# Copy environment template (edit .env if connecting external Postgres & Google OAuth)
cp .env.example .env

# Generate Prisma client
npm run db:generate

# Optional: if using external PostgreSQL in .env, apply migrations and seed
# npm run db:migrate && npm run db:seed

# Start web development server on http://localhost:3000
npm run dev
```

**`AUTH_SECRET` is required in production.** Auth.js signs its CSRF token and
OAuth state cookies with it. `npm run dev`, the tests and `npm run build` fall
back to a public development secret when it is unset, but `npm run start` (any
`NODE_ENV=production` server) refuses to handle requests without it. Generate
one per deployment and keep it out of the repository:

```bash
openssl rand -hex 32
```

The desktop apps and `npm run local:server` generate a fresh secret on every
launch, so they need no configuration.

<details>
<summary>Windows PowerShell Quick Start</summary>

```powershell
git clone https://github.com/TriBrigadeMars/titleix-policy-tracker.git
Set-Location .\titleix-policy-tracker
npm ci
Copy-Item .env.example .env
npm run db:generate
npm run dev
```
</details>

## Standalone Linux Desktop & AppImage

See [docs/DESKTOP-LOCAL-AND-RUST.md](./docs/DESKTOP-LOCAL-AND-RUST.md) for full details on Arch (`pacman` / `PKGBUILD`), Ubuntu (`deb`), Fedora (`rpm`), keyring setup (`secret-tool`), and the Rust/Tauri v2 shell.

```bash
# Build downloadable standalone AppImage (dist-desktop/*.AppImage)
npm run desktop:dist:appimage

# Build AppImage + Arch (.pacman) + Ubuntu (.deb) + Fedora (.rpm)
npm run desktop:dist:linux

# Build with the Rust / Tauri v2 shell
npm run tauri:build
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start web development server (`0.0.0.0:3000`) |
| `npm run build` | Production Next.js standalone build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check (web + local runtime) |
| `npm run desktop:typecheck` | TypeScript check (`electron/tsconfig.json`) |
| `npm test` | Run the Vitest unit & local-runtime suite |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run database migrations against `DATABASE_URL` |
| `npm run db:seed` | Seed jurisdictions, issue tags, and demo corpus |
| `npm run desktop:dist:appimage` | Build standalone Linux AppImage |
| `npm run desktop:dist:linux` | Build Linux AppImage, `pacman`, `deb`, and `rpm` packages |
| `npm run tauri:build` | Build standalone Rust/Tauri v2 desktop bundles |
| `npm run desktop:gate` | Evaluate Electron → Rust shell size/startup/RSS gate |

## Architecture & Status

- [ARCHITECTURE.md](./ARCHITECTURE.md) — domain model, design decisions, and authz invariants
- [docs/DESKTOP-LOCAL-AND-RUST.md](./docs/DESKTOP-LOCAL-AND-RUST.md) — standalone local mode (`app://tracker` → UDS → PGlite), Linux packages, and Rust shell
- [docs/PROGRESS.md](./docs/PROGRESS.md) — completed slices and review history
- [docs/ORCHESTRATOR.md](./docs/ORCHESTRATOR.md) — code quality bar and subagent protocol
