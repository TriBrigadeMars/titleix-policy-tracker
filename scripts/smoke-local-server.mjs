#!/usr/bin/env node
/**
 * Smoke test for a packaged desktop app: starts the bundled local server the
 * way `electron/local-runtime.ts` does and proves it serves the real app.
 *
 * Why this exists: the release workflow used to wait for the local server to
 * print `READY` and stop there. That passes even when every request returns
 * HTTP 500 (for example when the shell stops passing `AUTH_SECRET`). This
 * script spawns the *packaged* executable, waits for `READY`, then performs an
 * authenticated `GET /` over the app's own IPC endpoint and asserts a real
 * page came back.
 *
 * Works unchanged on Linux/macOS (Unix domain socket) and Windows (named
 * pipe), because `http.request({ socketPath })` accepts both. That is what
 * lets the same command guard the Linux packages, the Windows installer and
 * the release pipeline.
 *
 * Usage:
 *   node scripts/smoke-local-server.mjs [unpackedDir]
 *   npm run desktop:smoke
 *
 * `unpackedDir` is electron-builder's unpacked output (the folder holding
 * `resources/`). Defaults to `dist-desktop/win-unpacked` on Windows and
 * `dist-desktop/linux-unpacked` elsewhere; `DESKTOP_UNPACKED_DIR` also works.
 * Flags: `--exe <path>`, `--timeout <ms>`, `--keep` (keep the temp data dir).
 */
import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_TIMEOUT_MS = 180_000;

/** Unpacked output directory for the current platform. */
export function defaultUnpackedDir(platform = process.platform) {
  return path.join(
    "dist-desktop",
    platform === "win32" ? "win-unpacked" : "linux-unpacked"
  );
}

/** Executable electron-builder produces inside the unpacked directory. */
export function defaultExecutableName(platform = process.platform) {
  return platform === "win32"
    ? "Title IX Policy Tracker.exe"
    : "titleix-policy-tracker";
}

/**
 * Locate the packaged executable and the local-server entry it must run.
 * Throws with the paths it checked so a CI failure names the missing file.
 */
export function resolveSmokeTarget({
  unpackedDir = defaultUnpackedDir(),
  platform = process.platform,
  exe,
} = {}) {
  const root = path.resolve(unpackedDir);
  const exePath = path.resolve(root, exe || defaultExecutableName(platform));
  const entryPath = path.join(
    root,
    "resources",
    "local-bundle",
    "local-server-entry.cjs"
  );

  for (const [label, file] of [
    ["packaged executable", exePath],
    ["local server entry", entryPath],
  ]) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `${label} not found: ${file}\n` +
          "Run `npm run desktop:pack` (or the dist script) first."
      );
    }
  }
  return { unpackedDir: root, exePath, entryPath };
}

/**
 * Private IPC endpoint for the smoke run. A fresh named pipe per run avoids
 * colliding with an installed app; on POSIX a file inside the temp dir is
 * unlinked by the server on shutdown.
 */
export function smokeSocketPath(tempDir, platform = process.platform) {
  if (platform === "win32") {
    return `\\\\.\\pipe\\titleix-smoke-${process.pid}-${crypto
      .randomBytes(4)
      .toString("hex")}`;
  }
  return path.join(tempDir, "app.sock");
}

/** True when the response body is a rendered app page, not an error card. */
export function looksLikeAppPage(html) {
  if (typeof html !== "string" || html.length === 0) {
    return { ok: false, reason: "empty response body" };
  }
  if (html.length < 1_000) {
    return {
      ok: false,
      reason: `response body is only ${html.length} bytes`,
    };
  }
  if (!html.includes("Title IX")) {
    return { ok: false, reason: 'response body does not contain "Title IX"' };
  }
  for (const marker of [
    "Internal Server Error",
    "Application error",
    "Local Database Startup Error",
    "AUTH_SECRET is not set",
  ]) {
    if (html.includes(marker)) {
      return { ok: false, reason: `response body contains "${marker}"` };
    }
  }
  return { ok: true, reason: "rendered app page" };
}

/** HTTP GET over the app's IPC endpoint (Unix socket or Windows named pipe). */
export function requestOverSocket({
  socketPath,
  requestPath = "/",
  cookie,
  timeoutMs = 30_000,
}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path: requestPath,
        method: "GET",
        headers: { host: "tracker", ...(cookie ? { cookie } : {}) },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
        res.on("error", reject);
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error(`request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

function tail(text, max = 4_000) {
  return text.length > max ? text.slice(-max) : text;
}

/**
 * Start the packaged server, wait for `READY`, request a page, and shut down.
 * Resolves with a summary on success; throws with captured stderr on failure.
 */
export async function runSmoke({
  unpackedDir = defaultUnpackedDir(),
  exe,
  platform = process.platform,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  keep = false,
  log = console.log,
} = {}) {
  const target = resolveSmokeTarget({ unpackedDir, platform, exe });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "titleix-smoke-"));
  const dataDir = path.join(tempDir, "data");
  const socketPath = smokeSocketPath(tempDir, platform);
  const sessionToken = crypto.randomBytes(32).toString("hex");

  // Match the environment electron/local-runtime.ts builds for the child:
  // local mode, no DATABASE_URL, a per-launch AUTH_SECRET and session token.
  const childEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    TITLEIX_LOCAL_MODE: "1",
    TITLEIX_APP_DIR: path.dirname(target.entryPath),
    TITLEIX_DATA_DIR: dataDir,
    TITLEIX_SOCKET_PATH: socketPath,
    TITLEIX_SESSION_TOKEN: sessionToken,
    AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
  };
  delete childEnv.DATABASE_URL;

  log(`Smoke testing packaged app in ${target.unpackedDir}`);
  log(`  executable: ${target.exePath}`);
  log(`  data dir:   ${dataDir}`);
  log(`  endpoint:   ${socketPath}`);

  const child = spawn(target.exePath, [target.entryPath], {
    cwd: path.dirname(target.entryPath),
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let ready = false;
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
    if (!ready && stdout.includes("READY ")) ready = true;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const deadline = Date.now() + timeoutMs;
  try {
    while (!ready) {
      if (Date.now() > deadline) {
        throw new Error(
          `local server did not print READY within ${timeoutMs}ms\n` +
            `--- stdout ---\n${tail(stdout)}\n--- stderr ---\n${tail(stderr)}`
        );
      }
      const status = await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(() => resolve(null), 250)),
      ]);
      if (status) {
        throw new Error(
          `local server exited (code=${status.code}, signal=${status.signal}) before READY\n` +
            `--- stdout ---\n${tail(stdout)}\n--- stderr ---\n${tail(stderr)}`
        );
      }
    }

    const response = await requestOverSocket({
      socketPath,
      cookie: `authjs.session-token=${sessionToken}`,
    });
    if (response.status !== 200) {
      throw new Error(
        `GET / returned HTTP ${response.status}\n` +
          `--- body (first 500 bytes) ---\n${response.body.slice(0, 500)}\n` +
          `--- stderr ---\n${tail(stderr)}`
      );
    }
    const verdict = looksLikeAppPage(response.body);
    if (!verdict.ok) {
      throw new Error(
        `GET / did not return the app: ${verdict.reason}\n` +
          `--- stderr ---\n${tail(stderr)}`
      );
    }

    log(
      `PASS  GET / -> HTTP 200, ${response.body.length} bytes, ${verdict.reason}`
    );
    return {
      status: 200,
      bytes: response.body.length,
      unpackedDir: target.unpackedDir,
    };
  } finally {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
      const killed = await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(() => resolve("timeout"), 5_000)),
      ]);
      if (killed === "timeout") {
        child.kill("SIGKILL");
        await exited;
      }
    }
    if (platform !== "win32" && fs.existsSync(socketPath)) {
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // The server removes it on shutdown; best effort here.
      }
    }
    if (keep) {
      log(`Kept smoke data dir for inspection: ${tempDir}`);
    } else {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function parseArgs(argv) {
  const options = { unpackedDir: undefined, exe: undefined, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--keep") {
      options.keep = true;
    } else if (arg === "--exe") {
      options.exe = argv[(i += 1)];
    } else if (arg === "--timeout") {
      options.timeoutMs = Number(argv[(i += 1)]);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else if (!options.unpackedDir) {
      options.unpackedDir = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    await runSmoke({
      ...options,
      unpackedDir:
        options.unpackedDir ||
        process.env.DESKTOP_UNPACKED_DIR ||
        defaultUnpackedDir(),
    });
  } catch (error) {
    console.error(`FAIL  ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
