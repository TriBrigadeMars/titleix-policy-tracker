/** Product cap for comparison columns (and thus jurisdiction list filters). */
export const MAX_COMPARISON_JURISDICTIONS = 8;

/** Generous cap for issue-tag filters; the seeded set is 8. */
export const MAX_ISSUE_TAG_FILTERS = 32;

const MAX_ID_LENGTH = 64;

/** Parse a comma-separated query param into a trimmed, unique, non-empty id list. */
export function parseIdList(value: string | null): string[] {
  if (!value) return [];

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const entry of value.split(",")) {
    const id = entry.trim();
    if (!id || id.length > MAX_ID_LENGTH || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export type ComparisonQuery =
  | { ok: true; jurisdictionIds: string[]; issueTagIds: string[] }
  | { ok: false; error: string };

/** List endpoints must name jurisdictions; empty means "do not dump the table." */
export function parseComparisonQuery(
  searchParams: URLSearchParams
): ComparisonQuery {
  const jurisdictionIds = parseIdList(searchParams.get("jurisdictionIds"));
  const issueTagIds = parseIdList(searchParams.get("issueTagIds"));

  if (jurisdictionIds.length === 0) {
    return { ok: false, error: "Missing jurisdictionIds" };
  }
  if (jurisdictionIds.length > MAX_COMPARISON_JURISDICTIONS) {
    return {
      ok: false,
      error: `At most ${MAX_COMPARISON_JURISDICTIONS} jurisdictionIds`,
    };
  }
  if (issueTagIds.length > MAX_ISSUE_TAG_FILTERS) {
    return {
      ok: false,
      error: `At most ${MAX_ISSUE_TAG_FILTERS} issueTagIds`,
    };
  }

  return { ok: true, jurisdictionIds, issueTagIds };
}