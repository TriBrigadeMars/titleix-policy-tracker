# Desktop shell (`electron/` and `src-tauri/`)

This directory holds the Electron desktop shell for Title IX Policy Tracker; its Rust/Tauri v2 counterpart lives in [`src-tauri/`](../src-tauri). Both shells wrap the exact same shell-agnostic local server (`scripts/local-server.ts` / `local-bundle/local-server-entry.cjs`).

## Architecture (standalone local mode)

1. **Single-instance lock** (`app.requestSingleInstanceLock()`) prevents concurrent writers against the embedded database directory.
2. **OS keyring integration** (`electron/keyring.ts`): reads optional ingest API keys (`CONGRESS_GOV_API_KEY`, `OPEN_STATES_API_KEY`, `LEGISCAN_API_KEY`, `LEGISCAN_SESSION_ID`) from the Freedesktop Secret Service (`org.titleixpolicytracker.desktop`) on Arch, Ubuntu, and Fedora (or macOS Keychain / `safeStorage` fallback) and passes them via environment variables when spawning the local server.
3. **Zero-TCP Unix domain socket** (`electron/local-runtime.ts`): spawns the Next.js standalone + PGlite server bound exclusively to `$XDG_RUNTIME_DIR/titleix-policy-tracker/app.sock` (`0700` directory, `0600` socket) with persistent embedded Postgres files in `$XDG_DATA_HOME/titleix-policy-tracker/pgdata`.
4. **Custom scheme `app://tracker/…`**: intercepts renderer requests, injects `Cookie: authjs.session-token=<token>` on every forwarded request over `app.sock`, and strips `Set-Cookie` responses.

See [`docs/DESKTOP-LOCAL-AND-RUST.md`](../docs/DESKTOP-LOCAL-AND-RUST.md) for Linux packaging (AppImage, Arch, Ubuntu, Fedora) and the Milestone 3 Rust shell promotion gate.