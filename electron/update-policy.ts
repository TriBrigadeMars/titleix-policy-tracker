/**
 * Pure decision logic for the auto-update path.
 *
 * This module deliberately imports nothing from Electron or electron-updater:
 * every decision the updater makes is a total function of explicit inputs, so
 * it can be unit tested without spawning a window, and so `updater.ts` stays a
 * thin adapter rather than a place where policy hides.
 *
 * Why the configuration gate is not "just call checkForUpdates()":
 *
 * electron-updater's `NsisUpdater.verifySignature()` reads `publisherName`
 * from the packaged `app-update.yml`, and returns `null` — which the caller
 * treats as *verification succeeded* — when that key is absent. The skip
 * happens before the overridable `verifyUpdateCodeSignature` hook runs, so a
 * custom verifier cannot close the gap. A build whose update config carries no
 * publisher name therefore downloads and installs unverified binaries while
 * every layer of the library reports success.
 *
 * WP-15A hard rule 4 is explicit: unsigned ⇒ ship no updater. So the presence
 * of a publisher name is treated here as the precondition for running the
 * updater at all, rather than as an optimisation to add later.
 */

/** The subset of a packaged `app-update.yml` this policy reasons about. */
export interface PackagedUpdateConfig {
  provider: string;
  publisherName?: string | string[];
  channel?: string;
  url?: string;
}

export type UpdateConfigParse =
  | { kind: "OK"; config: PackagedUpdateConfig }
  | { kind: "SKIP"; reason: UpdateSkipReason };

export type UpdateSkipReason =
  | "not-packaged"
  | "config-missing"
  | "config-unreadable"
  | "config-invalid"
  | "publisher-name-missing"
  | "provider-unsupported"
  | "feed-url-missing"
  | "signature-verification-unsupported";

export interface UpdatePlan {
  /** Whether the updater may run at all in this process. */
  enabled: boolean;
  /** Populated only when `enabled` is false. */
  reason?: UpdateSkipReason;
  /** Publisher names the downloaded installer must be signed by, when enabled. */
  publisherNames: string[];
  /** Update channel the feed should be read from. */
  channel?: string;
}

export const DEFAULT_UPDATE_CHANNEL = "latest";

/**
 * Providers whose feed electron-updater can read without credentials in the
 * packaged app. `github` derives its location from `repository` in
 * package.json and the app's own version, so it needs neither a URL nor a
 * token for a public repository.
 */
const SUPPORTED_PROVIDERS = new Set(["github", "generic"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Normalise `publisherName` to a non-empty array of trimmed names.
 *
 * electron-updater's `windowsExecutableCodeSignatureVerifier` treats an empty
 * string as a *full distinguished name* comparison against a parsed DN of
 * zero entries, which silently matches nothing rather than erroring. Blank and
 * whitespace-only entries are dropped here so that failure mode is impossible.
 */
export function normalisePublisherNames(value: unknown): string[] {
  if (isNonEmptyString(value)) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isNonEmptyString)
    .map((name) => (name as string).trim());
}

/**
 * Parse the raw text of a packaged `app-update.yml`.
 *
 * Kept as a total function returning a discriminated union rather than
 * throwing, because the caller's only sane reaction to every failure here is
 * the same: do not run the updater, and log why.
 */
export function parseUpdateConfig(
  raw: string | null | undefined,
  parseYaml: (text: string) => unknown,
): UpdateConfigParse {
  if (raw == null) {
    return { kind: "SKIP", reason: "config-missing" };
  }
  if (raw.trim().length === 0) {
    return { kind: "SKIP", reason: "config-missing" };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return { kind: "SKIP", reason: "config-unreadable" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "SKIP", reason: "config-invalid" };
  }

  const record = parsed as Record<string, unknown>;
  if (!isNonEmptyString(record.provider)) {
    return { kind: "SKIP", reason: "config-invalid" };
  }

  const config: PackagedUpdateConfig = { provider: record.provider.trim() };
  if (record.publisherName !== undefined) {
    config.publisherName = record.publisherName as string | string[];
  }
  if (isNonEmptyString(record.channel)) {
    config.channel = record.channel.trim();
  }
  if (isNonEmptyString(record.url)) {
    config.url = record.url.trim();
  }

  return { kind: "OK", config };
}

/**
 * Decide whether the updater may start, and with what parameters.
 *
 * Deny-by-default: every path that is not provably safe returns
 * `enabled: false` with a reason. `isPackaged` is checked first because a dev
 * build has no `app-update.yml` at all and no signed installer to compare
 * against, so "not packaged" is the accurate diagnosis rather than
 * "config missing".
 */
export function planUpdate(
  isPackaged: boolean,
  parsed: UpdateConfigParse,
): UpdatePlan {
  if (!isPackaged) {
    return { enabled: false, reason: "not-packaged", publisherNames: [] };
  }

  if (parsed.kind === "SKIP") {
    return { enabled: false, reason: parsed.reason, publisherNames: [] };
  }

  const { config } = parsed;

  const publisherNames = normalisePublisherNames(config.publisherName);
  if (publisherNames.length === 0) {
    // The single most important gate: without this, electron-updater reports
    // success for an unsigned or wrong-publisher installer.
    return { enabled: false, reason: "publisher-name-missing", publisherNames: [] };
  }

  const provider = config.provider.trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return { enabled: false, reason: "provider-unsupported", publisherNames: [] };
  }

  // `generic` has no repository to derive a location from, so the feed URL is
  // mandatory. `github` resolves its own.
  if (provider === "generic" && !isNonEmptyString(config.url)) {
    return { enabled: false, reason: "feed-url-missing", publisherNames: [] };
  }

  return {
    enabled: true,
    publisherNames,
    channel: config.channel ?? DEFAULT_UPDATE_CHANNEL,
  };
}

/** Human-readable explanation for a skip, used in logs and the About dialog. */
export function describeSkipReason(reason: UpdateSkipReason): string {
  switch (reason) {
    case "not-packaged":
      return "development build; automatic updates are disabled";
    case "config-missing":
      return "app-update.yml is not packaged; automatic updates are disabled";
    case "config-unreadable":
      return "app-update.yml could not be read; automatic updates are disabled";
    case "config-invalid":
      return "app-update.yml is malformed; automatic updates are disabled";
    case "publisher-name-missing":
      return "app-update.yml declares no publisherName, so downloaded installers could not be signature-verified; automatic updates are disabled";
    case "provider-unsupported":
      return "update provider in app-update.yml is not supported; automatic updates are disabled";
    case "feed-url-missing":
      return "generic update feed declared no url; automatic updates are disabled";
        case "signature-verification-unsupported":
          return "this build's update provider cannot verify installer signatures; automatic updates are disabled";
      }
}

/**
 * Whether an update should be offered to the user, given the running version
 * and the version advertised by the feed.
 *
 * Uses semver's precedence rules via the supplied `compare`. Pre-release
 * downgrades and re-offers of the running version are rejected: re-prompting
 * to install what is already installed is a support burden, not a feature.
 */
export function shouldOfferUpdate(
  currentVersion: string,
  candidateVersion: string,
  compare: (a: string, b: string) => number,
): boolean {
  if (!isNonEmptyString(currentVersion) || !isNonEmptyString(candidateVersion)) {
    return false;
  }
  let result: number;
  try {
    result = compare(candidateVersion, currentVersion);
  } catch {
    // Unparseable version — refuse rather than guess.
    return false;
  }
  return result > 0;
}