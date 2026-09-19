// App identity and URL configuration for the Electron shell.
// Pure logic only: no Electron imports, no secrets.

export const APP_ID = "org.titleixpolicytracker.desktop";
export const APP_NAME = "Title IX Policy Tracker";
export const DESKTOP_MIN_WIDTH = 1000;
export const DESKTOP_MIN_HEIGHT = 700;
export const DESKTOP_DEFAULT_WIDTH = 1400;
export const DESKTOP_DEFAULT_HEIGHT = 900;

/**
 * Resolve the URL the desktop shell should load.
 *
 * Packaged builds must point at a real https deployment via
 * `DESKTOP_APP_URL`; a missing or non-https value is a fatal configuration
 * error and throws (the caller shows a fatal error window). Dev builds always
 * use the local Next.js dev server and ignore `DESKTOP_APP_URL` so a stale env
 * var can never point a dev build at production.
 */
export function resolveAppUrl(isPackaged: boolean): string {
  if (!isPackaged) {
    return "http://localhost:3000";
  }

  const appUrl = process.env.DESKTOP_APP_URL;
  if (!appUrl || !appUrl.startsWith("https://")) {
    throw new Error(
      `DESKTOP_APP_URL must be set to an https:// URL when packaged; got ${appUrl ?? "(unset)"}`,
    );
  }
  return appUrl;
}

/**
 * Extract the origin from an absolute http(s) URL, or null for anything else
 * (relative paths, non-http(s) schemes, unparseable strings). The origin
 * already normalizes away a trailing slash, so comparisons are stable.
 */
export function urlOrigin(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return parsed.origin;
}

/**
 * Allow-listed origins for the OAuth login flow (used by WP-07). Kept minimal:
 * the app origin plus the standard Google OAuth domains. Do not broaden.
 */
export function authAllowlistOrigins(appOrigin: string): string[] {
  return [appOrigin, "https://accounts.google.com", "https://www.google.com"];
}