# Install & run — Linux and Windows 11

The desktop app is standalone: it ships its own Next.js server and an embedded
PGlite (Postgres-in-WASM) database. **No PostgreSQL, no account, no API keys and
no network connection are required to use it.** First launch creates and seeds
the database locally.

Two ways to get it:

- **Download a build** (no toolchain) — from the [Releases](../../releases) page
  when a release is published, or from CI artifacts for the latest commit.
- **Build from source** (Node 22+) — see [Build from source](#build-from-source).

| Platform | Supported | Artifact | Shell |
|---|---|---|---|
| Linux x64 (Arch, Ubuntu, Fedora, other glibc distros) | ✅ | `.AppImage`, `.deb`, `.rpm`, `.pacman` | Electron |
| Windows 11 / 10 x64 | ✅ | `.exe` (assisted NSIS installer) | Electron |
| macOS | Not built | — | — |

> The Rust/Tauri shell in `src-tauri/` is a **Linux-only experimental** shell
> behind a measured promotion gate. It is not a Windows install path. See
> [DESKTOP-SHELLS.md](./DESKTOP-SHELLS.md).

---

## Linux

### Download

From the latest **Desktop Linux** GitHub Actions run (Artifacts →
`titleix-linux-electron-packages`), or from a published release:

```
TitleIX-Policy-Tracker-<version>-linux-*.AppImage   # any distro, no install
TitleIX-Policy-Tracker-<version>-linux-*.deb        # Debian / Ubuntu
TitleIX-Policy-Tracker-<version>-linux-*.rpm        # Fedora / RHEL
TitleIX-Policy-Tracker-<version>-linux-*.pacman     # Arch
```

### Install

```bash
# AppImage (universal)
chmod +x TitleIX-Policy-Tracker-*-linux-*.AppImage
./TitleIX-Policy-Tracker-*-linux-*.AppImage

# Debian / Ubuntu
sudo apt install ./TitleIX-Policy-Tracker-*-linux-amd64.deb

# Fedora / RHEL
sudo dnf install ./TitleIX-Policy-Tracker-*-linux-x86_64.rpm

# Arch
sudo pacman -U ./TitleIX-Policy-Tracker-*-linux-x86_64.pacman
```

The AppImage needs FUSE 2 (`libfuse2` on older releases, `libfuse2t64` on
Ubuntu 24.04+). If it is unavailable, run it without FUSE:

```bash
./TitleIX-Policy-Tracker-*-linux-*.AppImage --appimage-extract-and-run
```

### First launch

The app opens in **local mode** with the demo corpus already seeded. There is
no sign-in, no TCP port and no server to configure. The header shows a
“Local mode” badge.

### Where your data lives

| What | Path |
|---|---|
| Database (PGlite) | `${XDG_DATA_HOME:-~/.local/share}/titleix-policy-tracker/pgdata` (mode `0700`) |
| Runtime socket | `${XDG_RUNTIME_DIR}/titleix-policy-tracker/app.sock` (mode `0600`) |
| Window state, Chromium cache | `${XDG_CONFIG_HOME:-~/.config}/titleix-policy-tracker` |
| Optional ingest keys | OS keyring, service `org.titleixpolicytracker.desktop` |

### Uninstall

Remove the package (or delete the AppImage). Your data is **intentionally
kept** so a reinstall preserves your notes. To reset completely:

```bash
rm -rf ~/.local/share/titleix-policy-tracker ~/.config/titleix-policy-tracker
```

### Optional ingest API keys

Ingest is an optional, admin-only feature. Store keys in your keyring:

```bash
secret-tool store --label="Title IX Congress.gov Key" \
  service org.titleixpolicytracker.desktop username CONGRESS_GOV_API_KEY
```

Supported names: `CONGRESS_GOV_API_KEY`, `OPEN_STATES_API_KEY`,
`LEGISCAN_API_KEY`, `LEGISCAN_SESSION_ID`.

---

## Windows 11

### Download

From the latest **Desktop Windows** GitHub Actions run (Artifacts →
`titleix-windows-installer-unsigned-<sha>`), or from a published release:

```
TitleIX-Policy-Tracker-<version>-win-x64.exe
```

CI builds are **unsigned**, so Windows SmartScreen may say *“Windows protected
your PC”*. Choose **More info → Run anyway**. Signed releases are produced only
when the maintainer has configured a code-signing certificate
([DESKTOP-RELEASE-PIPELINE.md](./DESKTOP-RELEASE-PIPELINE.md)).

### Install

1. Run `TitleIX-Policy-Tracker-<version>-win-x64.exe`.
2. The assisted NSIS installer asks for an install directory (per-user install,
   **no administrator prompt**), and creates Start-menu and desktop shortcuts.
3. Launch **Title IX Policy Tracker** from the Start menu.

The app needs no network access: it communicates with its embedded server
over a per-user named pipe (`\\.\pipe\titleix-policy-tracker-<username>`),
never a TCP port.

### First launch

First launch creates and seeds the local database. It can take a few seconds;
the window appears while the embedded server starts.

### Where your data lives

| What | Path |
|---|---|
| Database (PGlite) | `%APPDATA%\titleix-policy-tracker\pgdata` |
| Window state, Chromium cache | `%APPDATA%\titleix-policy-tracker` |
| Local IPC | Named pipe `\\.\pipe\titleix-policy-tracker-<username>` |

To reset the app to its seeded state, close it and delete
`%APPDATA%\titleix-policy-tracker`. The uninstaller removes program files but
keeps this folder on purpose (`nsis.deleteAppDataOnUninstall: false`).

### Optional ingest API keys (Windows)

The Electron shell reads ingest keys from the Linux/macOS keyring only. On
Windows, set them as user environment variables before launching:

```powershell
setx CONGRESS_GOV_API_KEY "your-key"
```

then sign out and back in (or restart Explorer) so the app inherits the new
environment. Ingest is optional; the tracker works fully without it.

---

## Build from source

Requirements: **Node.js 22 or newer** and npm. No Rust, no database, no Docker.

### Linux

```bash
git clone https://github.com/TriBrigadeMars/titleix-policy-tracker.git
cd titleix-policy-tracker
npm ci
npm run db:generate

# Run the web app on http://localhost:3000 (embedded in-memory PGlite)
npm run dev

# Build and launch the packaged desktop app (unpacked, current platform)
npm run desktop:pack
npm run desktop:smoke                 # proves the packaged app serves a page
dist-desktop/linux-unpacked/titleix-policy-tracker

# Build installers (AppImage + pacman + deb + rpm)
npm run desktop:dist:linux
```

`desktop:dist:linux` needs `rpm`, `squashfs-tools`, `libarchive-tools` and
`libfuse2` on the build host (the CI workflow installs them).

### Windows 11 (PowerShell)

```powershell
git clone https://github.com/TriBrigadeMars/titleix-policy-tracker.git
Set-Location .\titleix-policy-tracker
npm ci
npm run db:generate

# Web app on http://localhost:3000
npm run dev

# Packaged desktop app + NSIS installer
npm run desktop:pack
npm run desktop:smoke
npm run desktop:dist:win

# Result:
#   dist-desktop\win-unpacked\Title IX Policy Tracker.exe
#   dist-desktop\TitleIX-Policy-Tracker-<version>-win-x64.exe
```

`npm run desktop:smoke` starts the packaged executable as Node, waits for the
local server, then requests `/` over the named pipe and asserts a rendered
page. It needs no display and is what CI runs on both operating systems.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| AppImage: `error loading libfuse.so.2` | Install FUSE 2 (`libfuse2`/`libfuse2t64`) or use `--appimage-extract-and-run`. |
| Windows: “Windows protected your PC” | Unsigned CI build — **More info → Run anyway**, or use a signed release. |
| “Local Database Startup Error” card | The database folder is not writable, or a second copy is running. Check permissions on the data folder above, close other instances, retry. |
| Blank window on first launch | The database is still seeding; wait a few seconds. If it persists, check the log at `<userData>/logs/main.log`. |
| “Sign in” is unavailable | Expected: local mode provisions a single local user. The header shows “Local mode”. |
| App won’t start twice | By design — a single-instance lock protects the database and socket. |
| Want a clean slate | Delete the database folder (see per-OS tables) and relaunch. |

## Verification status

- **Linux**: packaging, packaging contract, packaged local server and a real
  `GET /` were executed on Linux (`npm run desktop:pack`,
  `npm run desktop:verify-pack`, `npm run desktop:smoke`).
- **Windows**: the same commands run on `windows-latest` in
  `desktop-windows.yml` and `ci.yml`. Windows was **not** executed on the
  development machine used to write this guide.
