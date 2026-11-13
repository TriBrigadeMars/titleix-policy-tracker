/**
 * Server-side check for the standalone desktop runtime.
 *
 * Both desktop shells start the Next.js server with `TITLEIX_LOCAL_MODE=1`
 * (`electron/local-runtime.ts`, `scripts/local-server.ts`). In that mode the
 * shell injects one fixed session cookie into every request and the matching
 * session row is created only at boot, so anything that ends the session
 * locks the user out until the app restarts.
 *
 * `isDesktopApp()` in `is-desktop.ts` is the client-side counterpart and
 * cannot be used in a server component.
 */
export function isLocalMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  return env.TITLEIX_LOCAL_MODE === "1";
}
