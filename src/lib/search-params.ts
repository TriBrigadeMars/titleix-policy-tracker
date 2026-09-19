import { ALL_ROLES, type UserRole } from "./roles";

/** Product cap for comparison columns (and thus jurisdiction list filters). */
export const MAX_COMPARISON_JURISDICTIONS = 8;

/** Generous cap for issue-tag filters; the seeded set is 8. */
export const MAX_ISSUE_TAG_FILTERS = 32;

const MAX_ID_LENGTH = 64;

/**
 * Parse a `limit` query param into a positive, bounded integer. Missing or
 * non-positive values fall back to `fallback`; anything above `max` is clamped.
 */
function parseBoundedLimit(
  value: string | null,
  max: number,
  fallback: number
): number {
  const raw = Number.parseInt(value ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, max) : fallback;
}

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

export const DEFAULT_TRIAGE_LIMIT = 50;
export const MAX_TRIAGE_LIMIT = 100;

export type TriageRelevanceFilter =
  | "all"
  | "unreviewed"
  | "relevant"
  | "not_relevant";

export interface TriageQuery {
  jurisdictionCode?: string;
  status?:
    | "PROPOSED"
    | "PASSED"
    | "EFFECTIVE"
    | "ENJOINED"
    | "FAILED"
    | "VETOED"
    | "REPEALED";
  relevance: TriageRelevanceFilter;
  limit: number;
}

const VALID_STATUSES = new Set([
  "PROPOSED",
  "PASSED",
  "EFFECTIVE",
  "ENJOINED",
  "FAILED",
  "VETOED",
  "REPEALED",
]);

const VALID_RELEVANCE = new Set([
  "all",
  "unreviewed",
  "relevant",
  "not_relevant",
]);

export function parseTriageQuery(searchParams: URLSearchParams): TriageQuery {
  const rawJurisdiction = searchParams.get("jurisdiction")?.trim();
  const jurisdictionCode =
    rawJurisdiction && rawJurisdiction.length <= MAX_ID_LENGTH
      ? rawJurisdiction
      : undefined;

  const rawStatus = searchParams.get("status")?.trim().toUpperCase();
  const status =
    rawStatus && VALID_STATUSES.has(rawStatus)
      ? (rawStatus as TriageQuery["status"])
      : undefined;

  const rawRelevance = searchParams.get("relevance")?.trim().toLowerCase();
  const relevance: TriageRelevanceFilter =
    rawRelevance && VALID_RELEVANCE.has(rawRelevance)
      ? (rawRelevance as TriageRelevanceFilter)
      : "unreviewed";

  const limit = parseBoundedLimit(
      searchParams.get("limit"),
      MAX_TRIAGE_LIMIT,
      DEFAULT_TRIAGE_LIMIT
    );

    return { jurisdictionCode, status, relevance, limit };
}

export const DEFAULT_USER_LIST_LIMIT = 50;
export const MAX_USER_LIST_LIMIT = 100;

export interface UserListQuery {
  search?: string;
  role?: UserRole;
  limit: number;
}

export function parseUserListQuery(
  searchParams: URLSearchParams
): UserListQuery {
  const rawSearch = searchParams.get("search")?.trim();
  const search =
    rawSearch && rawSearch.length <= 100 ? rawSearch : undefined;

  const rawRole = searchParams.get("role")?.trim().toUpperCase();
  const role: UserRole | undefined =
    rawRole && ALL_ROLES.includes(rawRole as UserRole)
      ? (rawRole as UserRole)
      : undefined;

  const limit = parseBoundedLimit(
      searchParams.get("limit"),
      MAX_USER_LIST_LIMIT,
      DEFAULT_USER_LIST_LIMIT
    );

  return { search, role, limit };
}
