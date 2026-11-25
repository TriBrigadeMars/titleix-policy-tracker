/**
 * Shown when the database has no published instruments, which is the state of
 * a production install that seeded only the jurisdiction/tag catalogue. The
 * matrix and heatmap would otherwise render empty cells with no explanation.
 */
export function EmptyTrackerNotice() {
  return (
    <div className="container mx-auto px-4 pt-8">
      <div className="rounded-md border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="font-medium">
          No published instruments yet. This database has no Title IX-relevant
          records, so every view will be empty.
        </p>
        <p className="mt-1">
          Running locally? Load the demo corpus with{" "}
          <code className="font-mono text-xs">npm run db:seed:demo</code>, or
          fetch live data with{" "}
          <code className="font-mono text-xs">npm run ingest:scheduled</code>.
          See the README for API keys and the editor triage loop.
        </p>
      </div>
    </div>
  );
}
