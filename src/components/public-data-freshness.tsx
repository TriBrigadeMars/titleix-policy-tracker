import { summarizeFreshness } from "@/lib/freshness";
import type { PublicFreshness } from "@/lib/queries";

/**
 * Freshness is the stored ingest run when one exists. Instrument timestamps
 * are only the fallback. Warnings (a newer failed run, stale data) render on
 * their own line so they are not lost at the end of a sentence.
 *
 * `now` is injectable for tests; production omits it.
 */
export function PublicDataFreshness({
  freshness,
  now,
}: {
  freshness: PublicFreshness;
  now?: Date;
}) {
  const summary = summarizeFreshness(freshness, now);

  if (summary.state === "no-data") {
    return (
      <p className="text-xs text-muted-foreground mt-4">{summary.headline}</p>
    );
  }

  return (
    <div className="mt-4 space-y-1 text-xs text-muted-foreground">
      <p>
        {summary.headline}
        {summary.detail ? ` ${summary.detail}` : ""}
      </p>
      {summary.warnings.map((warning) => (
        <p key={warning} className="text-amber-700 dark:text-amber-400">
          {warning}
        </p>
      ))}
    </div>
  );
}
