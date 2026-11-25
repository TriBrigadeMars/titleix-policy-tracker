# Desktop shells: which one ships where (decision record)

The repository contains two desktop shells for the same local server:

- **Electron** — `electron/`, packaged by `electron-builder.yml`.
- **Rust / Tauri v2** — `src-tauri/`, packaged by `tauri.conf.json`.

They are not interchangeable today. Evidence below is from code and CI in this
repository, not from intent.

| Capability | Electron shell | Rust / Tauri shell | Evidence |
|---|---|---|---|
| Linux AppImage / deb / rpm / pacman | ✅ supported | ✅ built in CI, gated | `electron-builder.yml` linux targets; `src-tauri/tauri.conf.json` `bundle.targets: ["appimage","deb","rpm"]`; `.github/workflows/desktop-linux.yml` |
| Windows NSIS installer | ✅ supported (unsigned CI artifact; signed releases when a certificate is configured) | ❌ no target, no transport | `electron-builder.yml` `win.target: [nsis]`; Tauri bundle targets list no Windows target |
| Windows named-pipe IPC | ✅ | ❌ | `electron/local-runtime.ts` builds `\\.\pipe\titleix-policy-tracker-<user>`; `src-tauri/src/uds_proxy.rs` and `local_server.rs` are `#[cfg(unix)]` |
| Windows keyring | ❌ (env vars documented) | crate feature present, shell untested on Windows | `electron/keyring.ts` has Linux/macOS branches only; `Cargo.toml` enables `keyring/windows-native` |
| macOS | not built | not built | no darwin targets in either config |
| Tests in CI | unit + packaging + packaged-app smoke | `cargo test` + AppImage build | `desktop-linux.yml`, `desktop-windows.yml`, `ci.yml` |
| Promotion gate | reference implementation | must beat Electron on size/startup/RSS | `scripts/measure-shell-gate.ts` (`maxSizeRatioVsElectron: 0.6`, 2 500 ms, 180 MiB) |

## Decision

1. **Electron is the supported desktop shell on Linux and Windows 11.** Every
   install artifact a stranger can download comes from it.
2. **The Tauri shell stays in the repository as a Linux-only experimental
   shell**, measured by `npm run desktop:gate`. It is not offered as a Windows
   install path until it has (a) a Windows named-pipe transport, (b) a Windows
   bundle target in `tauri.conf.json`, and (c) a `windows-latest` CI job that
   builds and smokes it.
3. **No Windows artifact is ever produced twice.** `desktop-windows.yml` and
   `release.yml` build Electron only.

## Why not delete the Tauri shell?

It is not dead code: `cargo test` runs on every push, its AppImage is built in
`desktop-linux.yml`, it implements the same security model (scheme allowlist,
single-instance lock, cookie injection, keyring), and `desktop:gate` exists to
decide the migration on measurements rather than taste. Deleting it would
remove a tested implementation and the evidence path for the gate. The honest
problem was documentation over-claiming Windows parity, which this record and
`docs/INSTALL.md` fix.

## What would change this decision

- The Tauri shell gains a Windows transport and a `windows-latest` smoke job →
  both shells become candidates; the gate decides.
- The Tauri shell stops being maintained (no release artifact, failing CI) →
  delete it rather than keep a second untested path.

See [INSTALL.md](./INSTALL.md) for the user-facing install paths and
[DESKTOP-LOCAL-AND-RUST.md](./DESKTOP-LOCAL-AND-RUST.md) for the local-mode
architecture shared by both shells.
