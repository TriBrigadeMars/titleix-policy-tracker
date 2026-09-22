#!/usr/bin/env node
/**
 * Verifies the packaged desktop app's app.asar against the packaging contract.
 *
 * Run after `npm run desktop:pack`. Two properties must hold, and both are
 * checked by inspection of the real archive rather than by trusting the
 * `files:` allowlist in electron-builder.yml:
 *
 * 1. Every module in the electron-updater runtime closure is present. The
 *    `!node_modules/** / *` negation in electron-builder.yml drops
 *    electron-builder's automatic production-dependency collection, so a
 *    missing entry here is a silently broken updater (`require` throws at
 *    startup, long after the build went green).
 * 2. No secret material or server-only code is present. WP-14's asar audit
 *    proved this for the pre-updater build; re-including node_modules is
 *    exactly the kind of change that could regress it.
 */
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);

const ASAR_PATH = path.join("dist-desktop", "win-unpacked", "resources", "app.asar");

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
 * Hosted-app code that must never reach the client. The desktop shell is a
 * thin client against DESKTOP_APP_URL (WP-15B Deferred Item 5).
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
      "Run `npm run desktop:pack` first.",
  );
  process.exit(1);
}

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

if (process.exitCode) {
  console.error("\nDesktop packaging contract FAILED.");
} else {
  console.log("\nDesktop packaging contract satisfied.");
}