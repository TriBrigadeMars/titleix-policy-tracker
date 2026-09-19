# Electron desktop shell

This folder holds the Electron desktop shell for the Title IX Policy Tracker:
its TypeScript configuration, and (in later workplans) the main-process and
window-management code that wraps the deployed web app. It is intentionally
separate from the Next.js app in `src/` — the web app has its own `tsconfig.json`
and the Electron tree compiles with `electron/tsconfig.json` into `electron-dist/`.
See `desktop-workplans/00-PROJECT-CONTEXT.md` for the overall desktop plan and
how this folder fits into it.