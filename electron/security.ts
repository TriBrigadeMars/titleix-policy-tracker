// Pure URL classification functions for Electron navigation handling.
// No Electron imports — only pure functions over strings.

import { LOCAL_APP_URL, LOCAL_HOST, LOCAL_SCHEME } from "./constants";

export type UrlAction =
  | { kind: "ALLOW" } // in-app navigation
  | { kind: "OPEN_EXTERNAL" } // cancel here; open in system browser
  | { kind: "BLOCK" }; // cancel, do nothing else

const NETWORK_ERROR_CODES: ReadonlySet<number> = new Set<number>([
  -100, // ERR_CONNECTION_CLOSED
  -101, // ERR_CONNECTION_RESET
  -102, // ERR_CONNECTION_REFUSED
  -103, // ERR_CONNECTION_ABORTED
  -104, // ERR_NOT_CONNECTED
  -105, // ERR_NAME_NOT_RESOLVED
  -106, // ERR_INTERNET_DISCONNECTED
  -109, // ERR_ADDRESS_UNREACHABLE
  -113, // ERR_NETWORK_UNREACHABLE
  -118, // ERR_TIMED_OUT
  -127, // ERR_NETWORK_CHANGED
]);

export function isNetworkError(errorCode: number | string): boolean {
  const numeric =
    typeof errorCode === "string" ? Number(errorCode) : errorCode;
  if (!Number.isFinite(numeric)) {
    return false;
  }
  if (numeric >= 0) {
    return false;
  }
  return NETWORK_ERROR_CODES.has(numeric);
}

/**
 * Classify a URL for navigation handling.
 *
 * Rules, in order:
 * 1. Non-allowed schemes (javascript:, file:, data:, etc.) → BLOCK
 * 2. Same origin as appOrigin (`app://tracker` in local mode or `https://...` in remote mode) → ALLOW
 * 3. Origin in authOrigins AND authActive → ALLOW (OAuth flow in remote mode)
 * 4. Any other https: URL → OPEN_EXTERNAL (system browser)
 * 5. Everything else (including plain http: or foreign app:// host) → BLOCK
 */
export function classifyUrl(
  rawUrl: string,
  appOrigin: string,
  authOrigins: string[],
  authActive: boolean
): UrlAction {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { kind: "BLOCK" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { kind: "BLOCK" };
  }

  if (parsed.protocol === `${LOCAL_SCHEME}:`) {
    const normalizedOrigin =
      parsed.hostname === LOCAL_HOST && parsed.port === ""
        ? LOCAL_APP_URL
        : "";
    if (normalizedOrigin !== "" && normalizedOrigin === appOrigin) {
      return { kind: "ALLOW" };
    }
    return { kind: "BLOCK" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { kind: "BLOCK" };
  }

  const origin = parsed.origin;

  if (origin === appOrigin) {
    return { kind: "ALLOW" };
  }

  if (authActive && authOrigins.includes(origin)) {
    return { kind: "ALLOW" };
  }

  if (parsed.protocol === "https:") {
    return { kind: "OPEN_EXTERNAL" };
  }

  return { kind: "BLOCK" };
}

/**
 * Check if a URL is safe for external opening via shell.openExternal().
 * Returns true only for absolute https: URLs.
 */
export function isSafeExternalUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  return parsed.protocol === "https:";
}

/**
 * Create a guard for the OAuth authentication flow (used in remote mode).
 */
export function createAuthFlowGuard() {
  let isActive = false;

  return {
    begin: () => {
      isActive = true;
    },
    end: () => {
      isActive = false;
    },
    isActive: () => isActive,
  };
}