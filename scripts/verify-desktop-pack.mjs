#!/usr/bin/env node
/**
 * Verifies a packaged desktop app against the packaging contract.
 *
 * Usage: node scripts/verify-desktop-pack.mjs [unpackedDir]
 *
 * `unpackedDir` is electron-builder's unpacked output (the folder that holds
 * `resources/`). It can also be set with DESKTOP_UNPACKED_DIR. The default is
 * `dist-desktop/win-unpacked` on Windows and `dist-desktop/linux-unpacked`
 * elsewhere, which is what `npm run desktop:pack` produces on that platform.
 *
 * The desktop app is a standalone local app: the Electron shell (app.asar)
 * spawns the bundled Next.js server and PGlite from `resources/local-bundle`.
 * Everything is checked by inspecting the real output rather than by trusting
 * the `files:` / `extraResources:` lists in electron-builder.yml:
 *
 * 1. Every module in the electron-updater runtime closure is in app.asar. The
 *    `!node_modules/** / *` negation in electron-builder.yml drops
 *    electron-builder's automatic production-dependency collection, so a
 *    missing entry here is a silently broken updater (`require` throws at
 *    startup, long after the build went green).
 * 2. No secret material or server-only code is in app.asar. WP-14's asar audit
 *    proved this for the pre-updater build; re-including node_modules is
 *    exactly the kind of change that could regress it. These rules apply to
 *    app.asar only: local-bundle legitimately contains Next.js, React and
 *    Prisma, and names env variables such as DATABASE_URL in its code.
 * 3. The packed entry point is electron-dist/main.js.
 * 4. The local bundle the app starts from is packaged. Without it every launch
 *    ends on the "Local Database Startup Error" card.
 */
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);

const DEFAULT_UNPACKED_DIR = path.join(
  "dist-desktop",
  process.platform === "win32" ? "win-unpacked" : "linux-unpacked",
);
const UNPACKED_DIR =
  process.argv[2] || process.env.DESKTOP_UNPACKED_DIR || DEFAULT_UNPACKED_DIR;
const RESOURCES_DIR = path.join(UNPACKED_DIR, "resources");
const ASAR_PATH = path.join(RESOURCES_DIR, "app.asar");
const LOCAL_BUNDLE_DIR = path.join(RESOURCES_DIR, "local-bundle");

/**
 * Files the packaged app needs to start its local server. Paths are relative
 * to resources/local-bundle. `local-server-entry.cjs` is what
 * electron/local-runtime.ts spawns; `required-server-files.json` is the first
 * thing that entry reads to boot Next.js; `next` and `@prisma/client` are the
 * modules it requires. electron-builder silently drops a root `node_modules`
 * from an extraResources source, so their absence is a real failure mode.
 */
const REQUIRED_LOCAL_BUNDLE_FILES = [
  "local-server-entry.cjs",
  path.join(".next", "required-server-files.json"),
  path.join("node_modules", "next", "package.json"),
  path.join("node_modules", "@prisma", "client", "package.json"),
];

/** Runtime closure of electron-updater + electron-log, from `npm ls`. */
const REQUIRED_MODULES = [
  "electron-updater",
  "electron-log",
  "builder-util-runtime",
  "fs-extra",
  "graceful-fs",
  "jsonfile",
  "universalify",
  "js-yaml",
  "argparse",
  "lazy-val",
  "lodash.escaperegexp",
  "lodash.isequal",
  "semver",
  "tiny-typed-emitter",
  "debug",
  "ms",
  "sax",
];

/**
 * Server code that must never be in app.asar. The Electron main process does
 * not need it, and server code belongs in resources/local-bundle, which is
 * shipped outside the asar and is not subject to these rules.
 */
const FORBIDDEN_PATH_PATTERNS = [
  { label: "bundled Next.js app", pattern: /^\/src\// },
  { label: "Prisma schema/client", pattern: /^\/prisma\// },
  { label: "Next.js build output", pattern: /^\/\.next\// },
  { label: "next", pattern: /^\/node_modules\/next\// },
  { label: "react", pattern: /^\/node_modules\/(?:react|react-dom)\// },
  { label: "prisma", pattern: /^\/node_modules\/@?prisma[^/]*\// },
  { label: "next-auth", pattern: /^\/node_modules\/(?:next-auth|@auth)\// },
];

/**
 * Substrings that identify server credentials or secret-bearing env material.
 * Matched against the decoded text of every text-like file in the archive.
 * A hit means a secret is shipping to end users.
 */
const FORBIDDEN_CONTENT = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_GOOGLE_SECRET",
  "CONGRESS_GOV_API_KEY",
  "OPEN_STATES_API_KEY",
  "LEGISCAN_API_KEY",
];

const TEXT_FILE = /\.(?:js|mjs|cjs|json|yml|yaml|txt|html|css|node|md)$/i;

function fail(message) {
  console.error(`\u2716 ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`\u2714 ${message}`);
}

if (!fs.existsSync(ASAR_PATH)) {
  console.error(
    `Packaged archive not found at ${ASAR_PATH}.\n` +
      "Run `npm run desktop:pack` first, or pass the unpacked directory as an argument.",
  );
  process.exit(1);
}

console.log(`Verifying packaged app in ${UNPACKED_DIR}`);

const asar = require("@electron/asar");
const entries = asar.listPackage(ASAR_PATH);

// Normalise to forward-slash absolute paths inside the archive.
const entrySet = new Set(
  entries.map(
    (entry) => `/${String(entry).replace(/^[\\/]+/, "").replace(/\\/g, "/")}`,
  ),
);

// --- 1. updater dependency closure -----------------------------------------

const missing = REQUIRED_MODULES.filter(
  (name) => !entrySet.has(`/node_modules/${name}/package.json`),
);

if (missing.length > 0) {
  fail(`updater dependency closure incomplete — missing from asar: ${missing.join(", ")}`);
} else {
  ok(`updater dependency closure present (${REQUIRED_MODULES.length} modules)`);
}

// --- 2. no server code -----------------------------------------------------

let serverHits = 0;
for (const entry of entrySet) {
  for (const { label, pattern } of FORBIDDEN_PATH_PATTERNS) {
    if (pattern.test(entry)) {
      fail(`server-only code in asar: ${label} (${entry})`);
      serverHits += 1;
      break;
    }
  }
}
if (serverHits === 0) {
  ok("no Next.js/React/Prisma server code in asar");
}

// --- 3. no secrets ---------------------------------------------------------

const secretHits = [];
for (const entry of entrySet) {
  if (!TEXT_FILE.test(entry)) continue;
  let text;
  try {
    text = asar.extractFile(ASAR_PATH, entry.replace(/^\//, "")).toString("utf8");
  } catch {
    continue; // binary or unreadable entry — skip
  }
  for (const needle of FORBIDDEN_CONTENT) {
    if (text.includes(needle)) {
      secretHits.push(`${needle} in ${entry}`);
    }
  }
}

if (secretHits.length > 0) {
  for (const hit of secretHits) {
    fail(`secret material in asar: ${hit}`);
  }
} else {
  ok("no secret or env material in asar text files");
}

// --- 4. packed entry point -------------------------------------------------

try {
  const packedManifest = JSON.parse(
    asar.extractFile(ASAR_PATH, "package.json").toString("utf8"),
  );
  if (packedManifest.main !== "electron-dist/main.js") {
    fail(`unexpected packed entry point: ${packedManifest.main}`);
  } else {
    ok("packed entry point is electron-dist/main.js");
  }
} catch (error) {
  fail(`could not read packed package.json: ${error.message}`);
}

// --- 5. local bundle --------------------------------------------------------

const missingLocalFiles = REQUIRED_LOCAL_BUNDLE_FILES.filter(
  (relativePath) =>
    !fs
      .statSync(path.join(LOCAL_BUNDLE_DIR, relativePath), { throwIfNoEntry: false })
      ?.isFile(),
);

if (missingLocalFiles.length > 0) {
  for (const relativePath of missingLocalFiles) {
    fail(
      `local bundle incomplete — missing ${path.join("resources", "local-bundle", relativePath)}` +
        " (run `npm run desktop:stage-local` before electron-builder, and check" +
        " electron-builder.yml extraResources)",
    );
  }
} else {
  ok(`local bundle present (${REQUIRED_LOCAL_BUNDLE_FILES.length} required files)`);
}

if (process.exitCode) {
  console.error("\nDesktop packaging contract FAILED.");
} else {
  console.log("\nDesktop packaging contract satisfied.");
}