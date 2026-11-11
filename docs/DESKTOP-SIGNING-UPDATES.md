# WP-15A — Deferred: Code signing & automatic updates

Context: see [`docs/DESKTOP-RELEASE-PIPELINE.md`](./DESKTOP-RELEASE-PIPELINE.md) and [`electron/README.md`](../electron/README.md).

- **Status:** Backlog specification for signed binary distribution and background updates.

## Deferred Item 1 — Code signing

- **Windows:** Sign application binaries and the NSIS installer with a Windows code-signing certificate (EV / cloud HSM preferred) via CI secrets.
- **Linux:** Sign AppImage releases and `.deb`/`.rpm`/`pacman` checksums with a dedicated maintainer GPG key in CI.
- **Hard rule:** signing credentials are CI secrets. **NEVER** commit `.pfx` files, private GPG keys, passwords, or cloud credentials to Git.

Note: Defect D5 resolved the earlier `computeChannelNames` metadata crash by adding `repository`, `homepage`, `author`, and `description` to `package.json` and setting `publish: null` in `electron-builder.yml` until an update feed is configured.

## Deferred Item 2 — Automatic updates

- No background network updater runs in standalone local mode by default (preserving strict zero-background-network behavior unless the user triggers legislative ingest).
- When opt-in release checks are added later, updates must strictly verify cryptographic signatures before replacing binaries.
