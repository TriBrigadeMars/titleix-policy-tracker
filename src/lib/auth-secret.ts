/**
 * Committed to the repository, so it is public. It exists only so that
 * `next dev`, the test suite and `next build` work without configuration.
 * No production runtime path may use it; see `resolveAuthSecret`.
 */
export const DEV_ONLY_AUTH_SECRET =
  "titleix-policy-tracker-dev-fallback-secret-32chars";

export const MISSING_AUTH_SECRET_MESSAGE =
  "AUTH_SECRET is not set. Refusing to start in production without it.";

/** Value of `NEXT_PHASE` while `next build` imports route modules. */
const PRODUCTION_BUILD_PHASE = "phase-production-build";

export interface AuthSecretInputs {
  authSecret?: string;
  nodeEnv?: string;
  nextPhase?: string;
}

/**
 * Picks the secret Auth.js signs its CSRF token and OAuth state/PKCE cookies
 * with. A set `AUTH_SECRET` always wins (empty or whitespace-only counts as
 * unset). Without one, development, tests and the production build get the
 * public dev secret; a production server refuses to start.
 */
export function resolveAuthSecret({
  authSecret,
  nodeEnv,
  nextPhase,
}: AuthSecretInputs): string {
  if (authSecret !== undefined && authSecret.trim() !== "") {
    return authSecret;
  }
  if (nodeEnv !== "production") {
    return DEV_ONLY_AUTH_SECRET;
  }
  if (nextPhase === PRODUCTION_BUILD_PHASE) {
    return DEV_ONLY_AUTH_SECRET;
  }
  throw new Error(MISSING_AUTH_SECRET_MESSAGE);
}
