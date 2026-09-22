# Phase 2 Status — What Landed, What Is Blocked, What Is Still Needed

**Status:** PARTIALLY IMPLEMENTED. The unblocked work is built, verified locally, and on this branch. Two stages remain blocked on maintainer-supplied resources, not on code.
**Plan:** `docs/PHASE2-BUILD-PLAN.md`
**Backlog source:** `docs/DESKTOP-SIGNING-UPDATES.md` (WP-15A), `docs/DESKTOP-RELEASE-PIPELINE.md` (WP-15B)

## Summary

| Slice | Description | State |
|-------|-------------|-------|
| A | Code signing | **Blocked** — needs a Windows code-signing certificate (maintainer secret) |
| B | Release pipeline | **Implemented**; its *sign* stage is the same blocker as A |
| C | Automatic updates | **Implemented** — including the security gate that makes an unsigned build ship no updater |
| D | Clean-VM lifecycle test | **Blocked** — needs a fresh Windows 11 VM (cannot be run in this environment) |

Everything in Slices B and C that does not require a certificate is done and locally verified. Slice A and the sign stage of B are pure credential provisioning. Slice D is a test run, not a code change.

## What was implemented

### Release pipeline (Slice B)

`.github/workflows/release.yml` — new, tagged-releases-only Windows workflow. PR CI stays in `ci.yml`; this workflow publishes, so the two are deliberately separate.

- Trigger: `push` on `v*` tags, plus `workflow_dispatch` (with a `dry_run` input).
- Ordered gate: `npm ci → db:generate → lint → typecheck (web) → desktop:typecheck → test → build → desktop:compile → package → verify signature → verify packaging contract → checksums → upload → publish`.
- **Fails closed.** With no signing secrets configured it still builds and uploads artifacts (clearly labelled `unsigned`), emits a warning, and then the "Guard release publication" step `exit 1`s. No unsigned release is ever published, and no step ever claims a build was signed when it was not.
- The certificate is written to `$RUNNER_TEMP` and removed by an `if: always()` step that now runs **after** packaging (see "Defects found and fixed" below).
- The password is passed to electron-builder through `CSC_KEY_PASSWORD` in the environment rather than on the command line.
- Packaging uses `--publish never`; publication is an explicit, gated step.

### Auto-updates (Slice C)

- `electron/update-policy.ts` — **new.** Pure, dependency-free decision logic (parsing, the publisher-name gate, the plan, skip-reason descriptions, `shouldOfferUpdate`). Deliberately imports nothing from Electron or electron-updater so it is unit-testable without a window.
- `electron/update-policy.test.ts` — **new.** 52 table-driven vitest cases, all passing.
- `electron/updater.ts` — **new.** Main-process adapter. Reads the packaged `app-update.yml`, applies the policy, wires `electron-log`, and prompts on download. Cannot break the app: a missing, unreadable, or malformed update config disables updates and logs why.
- `electron/main.ts` — added a "Check for Updates…" Help item that truthfully reports whether automatic updates are enabled and why not, and starts the background check in `app.whenReady`.
- `electron/placeholder.ts` — **deleted** (dead file; flagged as cleanup in the plan).
- Preload surface is unchanged; all update logic is main-process only.

### Publish config / packaging

- `package.json` — added `electron-updater`, `electron-log`, a `repository` field, and a `desktop:verify-pack` script.
- `electron-builder.yml` — added `publish: { provider: github, releaseType: release }` and an explicit 17-entry allowlist for the updater's runtime dependency closure.
- `scripts/verify-desktop-pack.mjs` — **new.** Inspects the *built* asar and fails the build if the updater closure is incomplete, if server-only code (Next.js/React/Prisma) is present, or if any secret/env material is present.

## The security finding that shaped Slice C

`electron-updater` 6.8.9's `NsisUpdater.verifySignature()` reads `publisherName` from the packaged `app-update.yml`. **If that key is absent it returns `null`, which the caller treats as verification success.** The skip happens *upstream* of the overridable `verifyUpdateCodeSignature` hook, so a custom verifier cannot close the gap: an unsigned build's update path would download and install unverified binaries while every layer of the library reported success.

WP-15A hard rule 4 is explicit — unsigned ⇒ ship no updater — so the presence of a publisher name is treated as the precondition for running the updater at all:

- `update-policy.ts` refuses to enable updates when the packaged config declares no non-empty `publisherName`.
- `updater.ts` additionally overrides `verifyUpdateCodeSignature` (capturing the library's own implementation first) so that even at install time an empty publisher-name list is refused rather than trusted.

This was verified against the **real** generated artifact. The installer built here produced an `app-update.yml` with no `publisherName`, and the policy refused it:

```
parse: {"kind":"OK","config":{"provider":"github"}}
plan : {"enabled":false,"reason":"publisher-name-missing","publisherNames":[]}
```

So today, correctly: an unsigned build ships no working update path.

## Verification actually performed

Run locally on Windows, from the repo root:

| Gate | Result |
|------|--------|
| `npm run desktop:typecheck` | clean |
| `npm run typecheck` (after `npm run db:generate`) | clean |
| `npm run lint` | clean |
| `npm test` | 404 passed, 21 skipped (`electron/**/*.test.ts` is included by `vitest.config.mts`) |
| `npx vitest run electron/update-policy.test.ts` | 52/52 passed |
| `npm run desktop:pack` | succeeded |
| `npm run desktop:verify-pack` | contract satisfied — 17-module closure present, no server code, no secrets, entry point correct |
| `npx electron-builder --win --x64 --publish never` | **full NSIS installer built, no `computeChannelNames` crash** |
| `latest.yml` generated | yes — version, sha512, size, path |
| Policy against the real `app-update.yml` | correctly disabled (`publisher-name-missing`) |

The `computeChannelNames` crash recorded in the WP-14 audit is genuinely fixed: the full installer now builds and `latest.yml` is produced, because the `repository` field and `publish:` block let the channel resolve.

## Defects found and fixed during this work

1. **The release workflow deleted the signing certificate before building.** "Remove signing certificate" ran *before* "Build installer", so signing could never have worked. Reordered: package first, then the `if: always()` cleanup.
2. **`npm run desktop:dist:win -- --flag` does not work here.** npm 12 rejects `--` argument forwarding into a script (`Unknown cli flag`), so the certificate path and `--publish never` would never have reached electron-builder. The workflow now invokes `npx electron-builder` directly and runs the script's other two steps explicitly.
3. **Ambiguous publish behaviour.** electron-builder's `--publish` default on a tag push can auto-publish. Now explicitly `--publish never`, with publication as its own gated step.
4. **Artifact name lied when signed.** It was hardcoded `desktop-windows-unsigned-…`; it now reflects the actual signing state.
5. **`new NsisUpdater()` at module scope would crash startup.** The constructor reads the Electron app version and throws `ERR_UPDATER_INVALID_VERSION` if it is not valid semver, so constructing it at import time would turn a versioning mistake into a startup crash. It is now created lazily.

## What is still needed from the maintainer

### 1. A Windows code-signing certificate (blocks Slice A and the sign stage of Slice B)

Set these two repository secrets:

- `WINDOWS_CERTIFICATE_BASE64` — base64 of a `.pfx`
- `WINDOWS_CERTIFICATE_PASSWORD` — its password

Once both exist, the workflow's signing steps activate on their own; no workflow change is needed. Until then the release step deliberately refuses to publish.

**Open decision (plan decision 1):** EV certificate, or a cloud HSM signing service? Who provisions it, and how does CI reach it? A cloud-HSM service would need a different step in place of the base64 `.pfx` path.

**Note:** for the updater to actually work, the certificate must put a `publisherName` into the packaged `app-update.yml`. A signed build that still produces no publisher name will (correctly) continue to ship no updater — that is the intended behaviour, not a bug, but it is worth confirming the chosen signing path populates that field.

### 2. A fresh Windows 11 VM (blocks Slice D)

Slice D is a test run, not a code change, and cannot be performed here. The lifecycle to record, as a non-admin user:

**download → install → Start Menu launch → desktop shortcut → authenticate → close → reopen (session persistence) → upgrade → uninstall**

It should be written up as a dated `docs/DESKTOP-VM-LIFECYCLE.md` in the WP-14 style, and should explicitly close out the WP-14 functional-smoke items left `PENDING-ENV`. The recorded uninstall decision stands: uninstall removes program files but leaves `userData`. Confirm that behaviour rather than changing it.

The upgrade leg also requires a **second published version** to upgrade *from*, so Slice D genuinely depends on a signed, published release existing first.

### 3. Update-feed decision (plan decision 2)

I chose `provider: github` because it derives owner/repo from the `repository` field, so there is **no hardcoded feed URL to drift out of sync**. If a self-hosted `generic` feed or multiple channels are wanted instead, the `publish:` block in `electron-builder.yml` changes and `SUPPORTED_PROVIDERS` in `update-policy.ts` already accepts both. Worth a confirmation.

### 4. PR shape (plan decision 3)

This branch carries Slices B and C together. The plan recommends one slice per PR; the workplan snippets imply one per workplan. Say which you want and I will split or keep accordingly.

## Deliberately not done

- **No certificate material was created, downloaded, or committed.** No `.pfx`, password, or token exists anywhere in the tree; the workflow reads them from Actions secrets only.
- **No unsigned update path was shipped.** The updater is inert without a publisher name, by design.
- **No test was weakened.** The 52 new policy tests were written to encode the security property, not to accommodate it.
- **No product/Next.js feature code was touched.** This is infrastructure and packaging only, per the plan's scope.
- **Nothing was published.** No release was created and no tag was pushed.