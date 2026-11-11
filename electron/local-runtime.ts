import { spawn, type ChildProcess } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

const APP_SLUG = "titleix-policy-tracker";
const AUTH_SESSION_COOKIE = "authjs.session-token";
const SECURE_AUTH_SESSION_COOKIE = "__Secure-authjs.session-token";

export function resolveShellRuntimeDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  uid: number = typeof process.getuid === "function" ? process.getuid() : 1000
): string {
  if (platform !== "win32" && env.XDG_RUNTIME_DIR?.trim()) {
    return path.join(env.XDG_RUNTIME_DIR.trim(), APP_SLUG);
  }
  return path.join(os.tmpdir(), `${APP_SLUG}-${uid}`);
}

export function resolveShellSocketPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  uid: number = typeof process.getuid === "function" ? process.getuid() : 1000
): string {
  if (env.TITLEIX_SOCKET_PATH?.trim()) {
    return env.TITLEIX_SOCKET_PATH.trim();
  }
  if (platform === "win32") {
    const user = (env.USERNAME || "local").replace(/[^a-zA-Z0-9_-]/g, "_");
    return `\\\\.\\pipe\\${APP_SLUG}-${user}`;
  }
  return path.join(resolveShellRuntimeDir(env, platform, uid), "app.sock");
}

export function resolveShellDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homedir: string = os.homedir()
): string {
  if (env.TITLEIX_DATA_DIR?.trim()) {
    return env.TITLEIX_DATA_DIR.trim();
  }
  if (platform === "win32") {
    const base = env.APPDATA?.trim() || path.join(homedir, "AppData", "Roaming");
    return path.join(base, APP_SLUG);
  }
  if (platform === "darwin") {
    return path.join(homedir, "Library", "Application Support", APP_SLUG);
  }
  const xdgData =
    env.XDG_DATA_HOME?.trim() || path.join(homedir, ".local", "share");
  return path.join(xdgData, APP_SLUG);
}

export function resolveShellConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homedir: string = os.homedir()
): string {
  if (platform === "win32") {
    const base = env.APPDATA?.trim() || path.join(homedir, "AppData", "Roaming");
    return path.join(base, APP_SLUG);
  }
  if (platform === "darwin") {
    return path.join(homedir, "Library", "Application Support", APP_SLUG);
  }
  const xdgConfig =
    env.XDG_CONFIG_HOME?.trim() || path.join(homedir, ".config");
  return path.join(xdgConfig, APP_SLUG);
}

export function ensureShellPrivateDir(
  dirPath: string,
  platform: NodeJS.Platform = process.platform
): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  if (platform !== "win32") {
    fs.chmodSync(dirPath, 0o700);
  }
}

export function injectSessionCookieHeader(
  existingCookie: string | null | undefined,
  sessionToken: string
): string {
  const kept = (existingCookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;
      const eq = part.indexOf("=");
      const name = eq === -1 ? part : part.slice(0, eq).trim();
      return (
        name !== AUTH_SESSION_COOKIE && name !== SECURE_AUTH_SESSION_COOKIE
      );
    });
  kept.unshift(`${AUTH_SESSION_COOKIE}=${sessionToken}`);
  return kept.join("; ");
}

/**
 * Forward an Electron custom-scheme `Request` (`app://tracker/...`) over the
 * local Unix domain socket, injecting the local session cookie on every request.
 */
export async function proxyCustomSchemeToSocket(
  req: Request,
  socketPath: string,
  sessionToken: string
): Promise<Response> {
  const parsed = new URL(req.url);
  const targetPath = `${parsed.pathname || "/"}${parsed.search}`;

  const outHeaders: Record<string, string> = {};
  let incomingCookie: string | null = null;
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "cookie") {
      incomingCookie = value;
      return;
    }
    if (lower === "host" || lower === "connection") {
      return;
    }
    outHeaders[key] = value;
  });

  outHeaders["Host"] = "tracker";
  outHeaders["Cookie"] = injectSessionCookieHeader(
    incomingCookie,
    sessionToken
  );

  let bodyBuf: Buffer | null = null;
  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    const ab = await req.arrayBuffer();
    bodyBuf = Buffer.from(ab);
    outHeaders["Content-Length"] = String(bodyBuf.byteLength);
  }

  return new Promise<Response>((resolve, reject) => {
    const upstream = http.request(
      {
        socketPath,
        method: req.method,
        path: targetPath,
        headers: outHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const responseHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined) continue;
            // Never expose internal session Set-Cookie back to renderer JS
            if (k.toLowerCase() === "set-cookie") continue;
            if (Array.isArray(v)) {
              for (const item of v) responseHeaders.append(k, item);
            } else {
              responseHeaders.set(k, v);
            }
          }
          const payload = Buffer.concat(chunks);
          const status = res.statusCode ?? 502;
          const nullBodyStatus = status === 204 || status === 304;
          resolve(
            new Response(nullBodyStatus ? null : payload, {
              status,
              statusText: res.statusMessage ?? "",
              headers: responseHeaders,
            })
          );
        });
        res.on("error", reject);
      }
    );

    upstream.on("error", reject);
    if (bodyBuf && bodyBuf.byteLength > 0) {
      upstream.write(bodyBuf);
    }
    upstream.end();
  });
}

export interface ManagedLocalServer {
  readonly socketPath: string;
  readonly sessionToken: string;
  stop(): Promise<void>;
}

/**
 * Spawn the local Node Next.js + PGlite server bound exclusively to `socketPath`
 * (`$XDG_RUNTIME_DIR/titleix-policy-tracker/app.sock`) with keyring API keys
 * passed via child `env` at spawn.
 *
 * When packaged, runs via `ELECTRON_RUN_AS_NODE=1 process.execPath` so the
 * AppImage requires no system-installed Node.js runtime.
 */
export async function startManagedLocalServer(options: {
  isPackaged: boolean;
  resourcesPath: string;
  keyringEnv: Record<string, string>;
  startupTimeoutMs?: number;
}): Promise<ManagedLocalServer> {
  const socketPath = resolveShellSocketPath();
  const dataDir = resolveShellDataDir();
  if (process.platform !== "win32") {
    ensureShellPrivateDir(path.dirname(socketPath));
  }
  ensureShellPrivateDir(dataDir);

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const appDir = options.isPackaged
    ? path.join(options.resourcesPath, "local-bundle")
    : process.cwd();

  const serverScript = options.isPackaged
    ? path.join(appDir, "local-server-entry.cjs")
    : path.join(appDir, "node_modules", "tsx", "dist", "cli.mjs");

  const args = options.isPackaged
    ? [serverScript]
    : [serverScript, path.join(appDir, "scripts", "local-server.ts")];

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.keyringEnv,
    NODE_ENV: "production",
    ELECTRON_RUN_AS_NODE: "1",
    TITLEIX_LOCAL_MODE: "1",
    TITLEIX_APP_DIR: appDir,
    TITLEIX_DATA_DIR: dataDir,
    TITLEIX_SOCKET_PATH: socketPath,
    TITLEIX_SESSION_TOKEN: sessionToken,
    AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
  };
  delete childEnv.DATABASE_URL;

  const child: ChildProcess = spawn(process.execPath, args, {
    cwd: appDir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const timeoutMs = options.startupTimeoutMs ?? 30_000;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let stderrTail = "";

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for local server on ${socketPath}. ${stderrTail}`
        )
      );
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (!settled && text.includes("READY ")) {
        settled = true;
        clearTimeout(timer);
        resolve();
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
    });

    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `Local server exited prematurely (code=${code}, signal=${signal}): ${stderrTail}`
        )
      );
    });
  });

  let stopped = false;
  return {
    socketPath,
    sessionToken,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (child.exitCode === null && !child.killed) {
        await new Promise<void>((resolve) => {
          const forceTimer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 3000);
          child.once("exit", () => {
            clearTimeout(forceTimer);
            resolve();
          });
          child.kill("SIGTERM");
        });
      }
      if (process.platform !== "win32" && fs.existsSync(socketPath)) {
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Already unlinked by child
        }
      }
    },
  };
}
