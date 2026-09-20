// Pure URL classification functions for Electron navigation handling.
// No Electron imports — only pure functions over strings.

export type UrlAction =
  | { kind: "ALLOW" } // in-app navigation
  | { kind: "OPEN_EXTERNAL" } // cancel here; open in system browser
  | { kind: "BLOCK" }; // cancel, do nothing else

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