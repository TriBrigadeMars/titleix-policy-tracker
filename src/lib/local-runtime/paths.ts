import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const APP_RUNTIME_SLUG = "titleix-policy-tracker";

export type PathEnv = Readonly<Record<string, string | undefined>>;

/**
 * Resolve the per-user runtime directory (must be mode 0700 on POSIX).
 * Uses `$XDG_RUNTIME_DIR/titleix-policy-tracker` on Linux when set (systemd
 * sessions on Arch, Ubuntu, Fedora), falling back to a per-UID private
 * directory under `os.tmpdir()` when `XDG_RUNTIME_DIR` is absent.
 */
export function resolveRuntimeDir(
  env: PathEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  uid: number = typeof process.getuid === "function" ? process.getuid() : 1000
): string {
  if (platform !== "win32" && env.XDG_RUNTIME_DIR?.trim()) {
    return path.join(env.XDG_RUNTIME_DIR.trim(), APP_RUNTIME_SLUG);
  }
  return path.join(os.tmpdir(), `${APP_RUNTIME_SLUG}-${uid}`);
}

/**
 * Resolve the IPC endpoint for the standalone local server.
 * Never returns a TCP host:port — always a Unix domain socket path on
 * Linux/macOS or a named pipe on Windows.
 */
export function resolveSocketPath(
  env: PathEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  uid: number = typeof process.getuid === "function" ? process.getuid() : 1000
): string {
  if (env.TITLEIX_SOCKET_PATH?.trim()) {
    return env.TITLEIX_SOCKET_PATH.trim();
  }
  if (platform === "win32") {
    const user = (env.USERNAME || "local").replace(/[^a-zA-Z0-9_-]/g, "_");
    return `\\\\.\\pipe\\${APP_RUNTIME_SLUG}-${user}`;
  }
  return path.join(resolveRuntimeDir(env, platform, uid), "app.sock");
}

/**
 * Resolve the persistent local data directory (`$XDG_DATA_HOME/titleix-policy-tracker`
 * on Linux, defaulting to `~/.local/share/titleix-policy-tracker`).
 */
export function resolveDataDir(
  env: PathEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homedir: string = os.homedir()
): string {
  if (env.TITLEIX_DATA_DIR?.trim()) {
    return env.TITLEIX_DATA_DIR.trim();
  }
  if (platform === "win32") {
    const base = env.APPDATA?.trim() || path.join(homedir, "AppData", "Roaming");
    return path.join(base, APP_RUNTIME_SLUG);
  }
  if (platform === "darwin") {
    return path.join(
      homedir,
      "Library",
      "Application Support",
      APP_RUNTIME_SLUG
    );
  }
  const xdgData =
    env.XDG_DATA_HOME?.trim() || path.join(homedir, ".local", "share");
  return path.join(xdgData, APP_RUNTIME_SLUG);
}

/**
 * Resolve the per-user configuration directory (`$XDG_CONFIG_HOME/titleix-policy-tracker`
 * on Linux, defaulting to `~/.config/titleix-policy-tracker`).
 */
export function resolveConfigDir(
  env: PathEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homedir: string = os.homedir()
): string {
  if (platform === "win32") {
    const base = env.APPDATA?.trim() || path.join(homedir, "AppData", "Roaming");
    return path.join(base, APP_RUNTIME_SLUG);
  }
  if (platform === "darwin") {
    return path.join(
      homedir,
      "Library",
      "Application Support",
      APP_RUNTIME_SLUG
    );
  }
  const xdgConfig =
    env.XDG_CONFIG_HOME?.trim() || path.join(homedir, ".config");
  return path.join(xdgConfig, APP_RUNTIME_SLUG);
}

/**
 * Create `dirPath` if missing and enforce `0o700` permissions on POSIX so
 * neither the Unix domain socket nor PGlite files are accessible to other
 * local accounts.
 */
export function ensurePrivateDir(
  dirPath: string,
  platform: NodeJS.Platform = process.platform
): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  if (platform !== "win32") {
    fs.chmodSync(dirPath, 0o700);
    const mode = fs.statSync(dirPath).mode & 0o777;
    if (mode !== 0o700) {
      throw new Error(
        `Refusing to use directory ${dirPath}: expected mode 0700, got 0${mode.toString(8)}`
      );
    }
  }
}
