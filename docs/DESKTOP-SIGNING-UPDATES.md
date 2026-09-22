# WP-15A — Deferred: Code signing & automatic updates

Backlog record of workplan **WP-15A**. Context: read `desktop-workplans/00-PROJECT-CONTEXT.md` first (referenced from `electron/README.md`; it lives with the workplans, not in this repo).

- **Prerequisite:** WP-14B complete and approved by the maintainer.
- **Status:** Backlog specification only. **Not implemented — do not implement during Phase 1.**

## Deferred Item 1 — Code signing

- Sign both application binaries and the NSIS installer with a valid Windows code-signing certificate (EV / cloud HSM preferred).
- **Hard rule:** signing credentials are CI secrets. **NEVER** commit `.pfx` files, passwords, or cloud credentials to Git.
- When implemented, configure `win.certificateFile` / `win.certificatePassword` or `signtool` via CI environment variables.

Repo note for whoever picks this up: `electron-builder.yml` currently has no `win.certificate*` block and `package.json` has no `repository` field or `publish` block — the WP-14 audit (`docs/DESKTOP-AUDIT.md`) recorded a metadata-only `computeChannelNames` crash after `desktop:dist:win` for that reason. Signing work should resolve the publish configuration alongside the certificate setup rather than repeating the workaround.

## Deferred Item 2 — Automatic updates

- Ship install → launch → authenticate → operate → uninstall first in v1. No updater in v1.
- Future implementation: integrate `electron-updater` and `electron-log`.
- Flow: background check on startup → silent download → user notification → restart & install.
- Updates must strictly verify signatures to prevent binary tampering.

## Phase 2 future git & PR workflow (reference only)

When picking up Phase 2 items:

1. Create a dedicated branch: `git checkout -b desktop/phase2-signing-updates`
2. Commit implementation changes: `git commit -m "feat(desktop): phase 2 code signing and auto updates"`
3. Push and submit PR:

   ```bash
   gh pr create --base main --head desktop/phase2-signing-updates --title "feat(desktop): Phase 2 Code Signing & Updates" --body "Implements Windows code signing and background update checks."
   ```
