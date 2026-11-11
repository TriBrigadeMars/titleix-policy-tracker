// App identity, version extraction, and URL configuration for the Electron shell.
// Pure logic only: no Electron imports, no secrets.

export const APP_ID = "org.titleixpolicytracker.desktop";
export const APP_NAME = "Title IX Policy Tracker";
export const DESKTOP_MIN_WIDTH = 1000;
export const DESKTOP_MIN_HEIGHT = 700;
export const DESKTOP_DEFAULT_WIDTH = 1400;
export const DESKTOP_DEFAULT_HEIGHT = 900;

export const LOCAL_SCHEME = "app";
export const LOCAL_HOST = "tracker";
export const LOCAL_APP_URL = `${LOCAL_SCHEME}://${LOCAL_HOST}`;
export const VERSION_ARG_PREFIX = "--titleix-app-version=";

export type DesktopUrlEnv = Readonly<Record<string, string | undefined>>;

/**
 * Extract the application version inside a sandboxed preload process from
 * Chromium `additionalArguments` (`--titleix-app-version=x.y.z`), falling back
 * to `npm_package_version` in dev or `"0.0.0"`. Fixes Defect D3.
 */
export function resolvePreloadVersion(
  argv: readonly string[],
  envVersion?: string
): string {
  for (const arg of argv) {
    if (arg.startsWith(VERSION_ARG_PREFIX)) {
      const value = arg.slice(VERSION_ARG_PREFIX.length).trim();
      if (value.length > 0) {
        return value;
      }
    }
  }
  const fallback = envVersion?.trim();
  return fallback && fallback.length > 0 ? fallback : "0.0.0";
}

/**
 * Resolve the URL the desktop shell should load.
 *
 * - Dev builds default to `http://localhost:3000` (ignoring any stale
 *   `DESKTOP_APP_URL`), unless `DESKTOP_MODE=local` explicitly opts into the
 *   embedded `app://tracker` runtime.
 * - Packaged builds default to standalone local mode (`app://tracker`) when
 *   `DESKTOP_APP_URL` is unset, fixing Defect D2 so launching from a desktop
 *   entry or AppImage never fails with a missing-URL screen.
 * - When `DESKTOP_APP_URL` is explicitly provided to a packaged build (remote
 *   hosted deployment override), it must be an `https://` URL; anything else
 *   throws a fatal configuration error.
 */
export function resolveAppUrl(
  isPackaged: boolean,
  env: DesktopUrlEnv = process.env
): string {
  if (!isPackaged) {
    return env.DESKTOP_MODE === "local"
      ? LOCAL_APP_URL
      : "http://localhost:3000";
  }

  const appUrl = env.DESKTOP_APP_URL?.trim();
  if (!appUrl || env.DESKTOP_MODE === "local") {
    return LOCAL_APP_URL;
  }

  if (!appUrl.startsWith("https://")) {
    throw new Error(
      `DESKTOP_APP_URL must be set to an https:// URL when overriding local mode; got ${appUrl}`
    );
  }
  return appUrl;
}

/**
 * Extract the origin from an absolute `http(s)` URL or the local custom-scheme
 * `app://tracker` URL, or null for anything else.
 *
 * Note: WHATWG `new URL("app://tracker/path").origin` returns the literal
 * string `"null"` for non-special schemes, so `app:` is normalized explicitly.
 */
export function urlOrigin(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return parsed.origin;
  }
  if (
    parsed.protocol === `${LOCAL_SCHEME}:` &&
    parsed.hostname === LOCAL_HOST &&
    parsed.port === ""
  ) {
    return LOCAL_APP_URL;
  }
  return null;
}

export function isLocalModeUrl(rawUrl: string): boolean {
  return urlOrigin(rawUrl) === LOCAL_APP_URL;
}

/**
 * Allow-listed origins for the OAuth login flow (used only in remote hosted
 * mode; local mode authenticates via the injected Unix-socket session cookie).
 */
export function authAllowlistOrigins(appOrigin: string): string[] {
  return [appOrigin, "https://accounts.google.com", "https://www.google.com"];
}