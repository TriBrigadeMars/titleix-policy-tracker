/**
 * Display names for the ingest adapters stored in `Instrument.source`.
 *
 * The database keeps the adapter slug (`legiscan`) for provenance; the UI must
 * not show raw slugs to a reader who has never heard of the API.
 */
const SOURCE_LABELS: Record<string, string> = {
  legiscan: "LegiScan",
  openstates: "Open States",
  congress: "Congress.gov",
  federalregister: "Federal Register",
  fixture: "Demo fixture",
};

/** Human label for an ingest source, or `null` when there is no source. */
export function sourceLabel(
  source: string | null | undefined
): string | null {
  if (!source) return null;
  const key = source.trim().toLowerCase();
  if (!key) return null;
  return SOURCE_LABELS[key] ?? source.trim();
}
