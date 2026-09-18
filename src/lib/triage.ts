/**
 * Title IX relevance is a three-way determination persisted as two columns on
 * `Instrument`:
 *
 *   - `isTitleIXRelevant: boolean`
 *   - `relevanceConfidence: number | null`
 *
 * The three states are:
 *   - UNREVIEWED    -> (false, null)
 *   - RELEVANT      -> (true,  anything)
 *   - NOT_RELEVANT  -> (false, not null)
 *
 * This module is the single source of truth for deriving that status so the
 * encoding is never re-implemented per call site.
 */
export type TriageStatus = "unreviewed" | "relevant" | "not_relevant";

export function triageStatus(
  isTitleIXRelevant: boolean,
  relevanceConfidence: number | null
): TriageStatus {
  if (!isTitleIXRelevant && relevanceConfidence === null) return "unreviewed";
  if (isTitleIXRelevant) return "relevant";
  return "not_relevant";
}

/**
 * Inverse of {@link triageStatus}: the Prisma `where` predicate that selects a
 * status. Relevant rows ignore confidence entirely; "not_relevant" requires a
 * confidence (an editor made a call), while "unreviewed" is the default
 * `(false, null)` pair. Keeping these beside the derivation stops the encoding
 * from drifting between the query layer and the UI.
 */
export function triageWhere(
  status: TriageStatus
): {
  isTitleIXRelevant: boolean;
  relevanceConfidence?: { not: null } | null;
} {
  switch (status) {
    case "relevant":
      return { isTitleIXRelevant: true };
    case "not_relevant":
      return { isTitleIXRelevant: false, relevanceConfidence: { not: null } };
    case "unreviewed":
      return { isTitleIXRelevant: false, relevanceConfidence: null };
  }
}