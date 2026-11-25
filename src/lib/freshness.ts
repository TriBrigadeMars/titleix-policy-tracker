import { formatDateTime } from "./format-date";
import type { PublicFreshness } from "./queries";
import { sourceLabel } from "./sources";

/** Ingest older than this is called out as stale on public pages. */
export const STALE_AFTER_DAYS = 7;

const MS_PER_DAY = 86_400_000;

export type FreshnessState = "no-data" | "fresh" | "stale" | "failed";

export interface FreshnessSummary {
  state: FreshnessState;
  headline: string;
  detail: string | null;
  warnings: string[];
  /** Whole days since the newest data, or `null` when there is no timestamp. */
  ageDays: number | null;
}

function parseTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Turn the stored ingest facts into one sentence plus explicit warnings.
 *
 * `now` is a parameter so the stale threshold is testable without fake timers.
 * A failed run is reported when it is newer than the last success: an older
 * failure is history, not the current state of the data.
 */
export function summarizeFreshness(
  freshness: PublicFreshness,
  now: Date = new Date()
): FreshnessSummary {
  const lastSuccess = parseTimestamp(freshness.lastSuccessfulRunAt);
  const newestChecked = parseTimestamp(freshness.newestLastCheckedAt);
  const base = lastSuccess ?? newestChecked;

  if (!base) {
    return {
      state: "no-data",
      headline: "No ingest run has been recorded yet.",
      detail: null,
      warnings: [],
      ageDays: null,
    };
  }

  const ageDays = Math.max(
    0,
    Math.floor((now.getTime() - base.getTime()) / MS_PER_DAY)
  );

  const source = sourceLabel(freshness.lastSuccessfulSource);
  const headline = lastSuccess
    ? `Last successful ingest${source ? ` (${source})` : ""}: ${formatDateTime(lastSuccess)}.`
    : `Data last checked: ${formatDateTime(base)}.`;

  const oldestChecked = parseTimestamp(freshness.oldestLastCheckedAt);
  const detail =
    oldestChecked && newestChecked && oldestChecked < newestChecked
      ? `Instrument checks range from ${formatDateTime(oldestChecked)} to ${formatDateTime(newestChecked)}.`
      : null;

  const warnings: string[] = [];
  const lastFailure = parseTimestamp(freshness.lastFailedRunAt);
  const failedIsNewer = lastFailure && (!lastSuccess || lastFailure > lastSuccess);

  if (failedIsNewer && lastFailure) {
    warnings.push(
      `Latest ingest run failed${freshness.lastFailedErrorClass ? ` (${freshness.lastFailedErrorClass})` : ""} at ${formatDateTime(lastFailure)}.`
    );
  }
  if (ageDays > STALE_AFTER_DAYS) {
    warnings.push(
      `Newest data is ${ageDays} days old. Treat counts as stale until the next successful ingest.`
    );
  }

  const state: FreshnessState =
    failedIsNewer && lastFailure ? "failed" : ageDays > STALE_AFTER_DAYS ? "stale" : "fresh";

  return { state, headline, detail, warnings, ageDays };
}
