# Title IX Policy Tracker

Track proposed and passed laws impacting Title IX across the United States.

A legislative and regulatory impact tracker for researchers, advocates, and
journalists. Compare proposed or recently passed laws, regulations, and policies
at the state and federal level that impact Title IX.

## Install & run (no build, no database, no account)

The desktop app is standalone: it bundles its own Next.js server and an embedded
PGlite (Postgres-in-WASM) database. First launch creates and seeds the database
locally. No PostgreSQL, no API keys, no OAuth and no network connection are
needed to browse and edit.

| OS | Download | Install |
|---|---|---|
| **Linux x64** | `TitleIX-Policy-Tracker-<version>-linux-x86_64.AppImage` (or `.deb`, `.rpm`, `.pacman`) | `chmod +x *.AppImage && ./TitleIX-Policy-Tracker-*.AppImage` |
| **Windows 11 / 10 x64** | `TitleIX-Policy-Tracker-<version>-win-x64.exe` | Run the assisted NSIS installer (per-user, no admin prompt) |

Get them from the [Releases](../../releases) page, or — for the latest commit —
from the **Desktop Linux** / **Desktop Windows** GitHub Actions artifacts. CI
Windows installers are unsigned, so SmartScreen may ask for **More info → Run
anyway**.

Full instructions, data locations, upgrades, uninstall and troubleshooting:
**[docs/INSTALL.md](./docs/INSTALL.md)**.

| OS | Database | App state |
|---|---|---|
| Linux | `${XDG_DATA_HOME:-~/.local/share}/titleix-policy-tracker` | `${XDG_CONFIG_HOME:-~/.config}/titleix-policy-tracker` |
| Windows | `%APPDATA%\titleix-policy-tracker` | `%APPDATA%\titleix-policy-tracker` |

The desktop app talks to its embedded server over local IPC only — a `0700`
Unix socket on Linux or a per-user named pipe on Windows. It never opens a TCP
port.

## Overview

Public views need no account:
- **Bills & regulations** (`/bills`) — search titles, summaries and bill numbers; filter by jurisdiction, status and type; sort and page through results.
- **Instrument detail** (`/instruments/<id>`) — status, key dates, issue areas, ingest source, source record id, last-checked time, and a link to the primary source.
- **Comparison matrix** (`/`) — jurisdiction × issue-area cells with editor-written comparisons.
- **National heatmap** (`/heatmap`) — Title IX activity by state, linked into the comparison view.
- **Download** — CSV or JSON of the filtered public dataset at `/api/export/instruments?format=csv|json`.

Editor work (triage, tagging, notes) requires an account. Every public view
shows only instruments an editor marked `RELEVANT`; triage notes stay behind
the editor role.

Runs in two modes from the same codebase:

- **Hosted web app**: Next.js 15 App Router + PostgreSQL + Google OAuth
  (`npm run dev` / `npm run build`).
- **Standalone desktop app**: embedded PGlite database, single local user, OS
  keyring ingest keys. The shipping shell on both Linux and Windows is
  **Electron** (`electron/`). The Rust/Tauri v2 shell (`src-tauri/`) is a
  Linux-only experimental shell behind a measured promotion gate — see
  [docs/DESKTOP-SHELLS.md](./docs/DESKTOP-SHELLS.md).

## Quick Start (from source)

Requires **Node >= 22** (tested on Node 22 LTS through Node 26). For the hosted
web mode with external PostgreSQL, **PostgreSQL 16+** is used in CI; without
`DATABASE_URL`, the dev server automatically boots an embedded in-memory PGlite
instance seeded with the demo corpus — so `npm run dev` needs no database.

### Linux / macOS (bash/zsh)

```bash
# Clone and enter the repository
git clone https://github.com/TriBrigadeMars/titleix-policy-tracker.git
cd titleix-policy-tracker

# Install dependencies and generate the Prisma client
npm ci
npm run db:generate

# Copy environment template (edit .env only if connecting external Postgres & Google OAuth)
cp .env.example .env

# Optional: if using external PostgreSQL in .env, apply migrations and seed
# npm run db:migrate && npm run db:seed

# Start the web development server on http://localhost:3000
npm run dev
```

### Windows 11 (PowerShell)

```powershell
git clone https://github.com/TriBrigadeMars/titleix-policy-tracker.git
Set-Location .\titleix-policy-tracker

npm ci
npm run db:generate

Copy-Item .env.example .env

npm run dev
```

### Desktop app from source

```bash
npm run desktop:pack      # unpacked app for the current OS
npm run desktop:smoke     # starts it headlessly and asserts a real page loads
npm run desktop:dist:linux   # Linux: AppImage + pacman + deb + rpm
npm run desktop:dist:win     # Windows: NSIS installer (run on Windows)
```

`desktop:pack` builds the Next.js standalone bundle, stages the local
server + PGlite + migrations into `local-bundle/`, compiles the Electron main
process and packages it. `desktop:smoke` launches the packaged executable as
Node, waits for the local server, then performs an authenticated `GET /` over
the app's socket/named pipe and asserts a rendered page — the proof that a
fresh install actually runs.

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

## Database seeding

`npm run db:seed` always installs the 52 jurisdictions and 8 issue tags.
In production (`NODE_ENV=production`) it installs only that catalogue unless
`SEED_DEMO=1` is set. Development seeding includes the demo corpus by default.
Re-running either seed preserves existing instruments, triage, issue tags and
cell-note text, and records the fixture ingest only once. A fresh desktop
database still gets the demo corpus on first launch.

```bash
NODE_ENV=production npm run db:seed              # catalogue only
NODE_ENV=production SEED_DEMO=1 npm run db:seed  # add demo rows
npm run db:seed:demo                             # same, cross-platform (incl. PowerShell)
```

`npm run db:seed:demo` passes `--demo` to the seed script, so it works where
inline environment variables do not. When the database has no published
instruments, `/`, `/bills` and `/heatmap` say so and point at this command.

## Public dataset export

`GET /api/export/instruments` returns the same rows as `/bills`, using the same
query parameters (`q`, `jurisdiction`, `status`, `type`, `sort`).

```bash
curl -O 'http://localhost:3000/api/export/instruments?format=csv&status=PASSED'
curl 'http://localhost:3000/api/export/instruments?format=json&jurisdiction=CA' | jq .
```

CSV is RFC 4180 with a UTF-8 BOM (Excel on Windows) and ISO-8601 timestamps.
JSON carries `generatedAt`, `count`, `truncated` and the records. A response is
capped at 1,000 rows; `truncated` (and `X-Result-Truncated`) says whether the cap
cut the result. The endpoint is read-only and exposes no notes or triage state.

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
| `npm run db:seed` | Seed catalogue; demo corpus outside production or with `SEED_DEMO=1` |
| `npm run desktop:prepare` | Build + stage local bundle + compile Electron shell |
| `npm run desktop:pack` | Unpacked desktop app for the current OS (`dist-desktop/`) |
| `npm run desktop:smoke` | Launch the packaged app and assert `GET /` returns the app |
| `npm run desktop:verify-pack` | Assert the packaged asar/local-bundle contract |
| `npm run db:seed:demo` | Seed catalogue and demo corpus (`--demo`; cross-platform) |
| `npm run desktop:dist:appimage` | Build standalone Linux AppImage |
| `npm run desktop:dist:linux` | Build Linux AppImage, `pacman`, `deb`, and `rpm` packages |
| `npm run desktop:dist:win` | Build the Windows NSIS installer (run on Windows) |
| `npm run tauri:build` | Build the experimental Rust/Tauri v2 Linux bundles |
| `npm run desktop:gate` | Evaluate the Electron → Rust shell size/startup/RSS gate |

## Architecture & Status

- [docs/INSTALL.md](./docs/INSTALL.md) — install and run on Linux and Windows 11
- [ARCHITECTURE.md](./ARCHITECTURE.md) — domain model, design decisions, and authz invariants
- [docs/DESKTOP-LOCAL-AND-RUST.md](./docs/DESKTOP-LOCAL-AND-RUST.md) — standalone local mode (`app://tracker` → IPC → PGlite), Linux packages, and Rust shell
- [docs/DESKTOP-SHELLS.md](./docs/DESKTOP-SHELLS.md) — which desktop shell ships on which OS, with evidence
- [docs/DESKTOP-RELEASE-PIPELINE.md](./docs/DESKTOP-RELEASE-PIPELINE.md) — CI packaging, release gates and signing
- [docs/PROGRESS.md](./docs/PROGRESS.md) — completed slices and review history
- [docs/ORCHESTRATOR.md](./docs/ORCHESTRATOR.md) — code quality bar and subagent protocol
