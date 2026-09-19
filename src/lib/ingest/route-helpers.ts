/**
 * HTTP-level helpers shared by the ingest trigger routes.
 *
 * These are deliberately separate from `src/lib/ingest/index.ts`: that module is
 * the data layer (adapters + upsert) and must not depend on anything
 * request-shaped. Route plumbing lives here instead.
 */

/**
 * Upstream errors can carry API keys or internal URLs, so ingest routes log the
 * real error server-side and return this generic message to the caller.
 */
export const INGEST_GENERIC_ERROR = "Ingest failed. Check server logs for details.";

/**
 * Parse an integer query param, clamped to `[min, max]` and truncated toward
 * zero. Anything missing or non-finite falls back to `fallback` — a garbage
 * value must never reach an adapter as `NaN`.
 */
export function paramInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
