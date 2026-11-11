import { formatDateTime } from "@/lib/format-date";
import type { PublicFreshness } from "@/lib/queries";

/**
 * Freshness is the stored ingest run when one exists. Instrument timestamps
 * are only the fallback.
 */
export function PublicDataFreshness({
  freshness,
}: {
  freshness: PublicFreshness;
}) {
  const {
    lastSuccessfulRunAt,
    lastSuccessfulSource,
    lastFailedRunAt,
    lastFailedErrorClass,
    oldestLastCheckedAt,
    newestLastCheckedAt,
  } = freshness;

  const failedIsNewer =
    lastFailedRunAt != null &&
    (lastSuccessfulRunAt == null || lastFailedRunAt > lastSuccessfulRunAt);

  if (!lastSuccessfulRunAt && !newestLastCheckedAt) {
    return (
      <p className="text-xs text-muted-foreground mt-4">
        No ingest run has been recorded yet.
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground mt-4">
      {lastSuccessfulRunAt ? (
        <>
          Last successful ingest
          {lastSuccessfulSource ? ` (${lastSuccessfulSource})` : ""}:{" "}
          {formatDateTime(lastSuccessfulRunAt)}.
        </>
      ) : newestLastCheckedAt ? (
        <>
          Data last checked: {formatDateTime(newestLastCheckedAt)}.
        </>
      ) : null}
      {oldestLastCheckedAt &&
        newestLastCheckedAt &&
        oldestLastCheckedAt !== newestLastCheckedAt && (
          <>
            {" "}
            Instrument checks range from {formatDateTime(oldestLastCheckedAt)}{" "}
            to {formatDateTime(newestLastCheckedAt)}.
          </>
        )}
      {failedIsNewer && lastFailedRunAt && (
        <>
          {" "}
          Latest run failed
          {lastFailedErrorClass ? ` (${lastFailedErrorClass})` : ""} at{" "}
          {formatDateTime(lastFailedRunAt)}.
        </>
      )}
    </p>
  );
}
