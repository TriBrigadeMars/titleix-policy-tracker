// Pure URL classification functions for Electron navigation handling.
// No Electron imports — only pure functions over strings.

export type UrlAction =
  | { kind: "ALLOW" } // in-app navigation
  | { kind: "OPEN_EXTERNAL" } // cancel here; open in system browser
  | { kind: "BLOCK" }; // cancel, do nothing else

/**
 * Chromium net error codes that represent a transport-level failure
 * (no connectivity / unreachable / refused / timed out). Reported as
 * negative integers from `did-fail-load`. HTTP application status codes
 * (404, 500, …) come through as non-negative numbers, and `ERR_ABORTED`
 * (-20) is a user-initiated cancel, so neither belongs in this set.
 *
 * Source: net/base/net_error_list.h in Chromium.
 */
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

/**
 * Classify a Chromium `did-fail-load` error code as a network failure.
 *
 * - Negative integers inside `NETWORK_ERROR_CODES` → true.
 * - Non-negative numbers (HTTP status codes, e.g. 404/500) → false.
 * - `ERR_ABORTED` (-20) and similar user-cancel codes → false.
 * - Unparseable strings → false.
 *
 * Accepts strings because Electron has historically passed stringified
 * codes in some code paths; we coerce defensively rather than throwing.
 */
export function isNetworkError(errorCode: number | string): boolean {
  const numeric = typeof errorCode === "string" ? Number(errorCode) : errorCode;
  if (!Number.isFinite(numeric)) {
    return false;
  }
  if (numeric >= 0) {
    // Non-negative codes are HTTP status codes or "no error"; never network.
    return false;
  }
  return NETWORK_ERROR_CODES.has(numeric);
}

/**
 * Classify a URL for navigation handling.
 *
 * Rules, in order:
 * 1. Non-http(s) schemes (javascript:, file:, data:, etc.) → BLOCK
 * 2. Same origin as appOrigin → ALLOW
 * 3. Origin in authOrigins AND authActive → ALLOW (OAuth flow in progress)
 * 4. Any other https: URL → OPEN_EXTERNAL
 * 5. Everything else (including plain http: to foreign host) → BLOCK
 */
export function classifyUrl(
  rawUrl: string,
  appOrigin: string,
  authOrigins: string[],
  authActive: boolean
): UrlAction {
  // Rule 1: Non-http(s) schemes → BLOCK
  if (!rawUrl || typeof rawUrl !== "string") {
    return { kind: "BLOCK" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { kind: "BLOCK" };
  }

  // Block non-http(s) schemes
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { kind: "BLOCK" };
  }

  const origin = parsed.origin;

  // Rule 2: Same origin as appOrigin → ALLOW
  if (origin === appOrigin) {
    return { kind: "ALLOW" };
  }

  // Rule 3: Origin in authOrigins AND authActive → ALLOW
  if (authActive && authOrigins.includes(origin)) {
    return { kind: "ALLOW" };
  }

  // Rule 4: Any other https: URL → OPEN_EXTERNAL
  // Note: This includes known external domains (congress.gov, legiscan.com, etc.)
  // and also unknown https URLs. The test table shows evil.example.org should
  // be BLOCK, but the rules say "any other https: URL → OPEN_EXTERNAL".
  // Following the rules as written:
  if (parsed.protocol === "https:") {
    return { kind: "OPEN_EXTERNAL" };
  }

  // Rule 5: Everything else (including plain http:) → BLOCK
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
 * Create a guard for the OAuth authentication flow.
 * While active, URLs matching authOrigins are treated as ALLOW.
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