import type { Prisma } from "@prisma/client";
import type { InstrumentStatus, InstrumentType } from "@/types";
import { isInstrumentStatus, isInstrumentType } from "./instrument-meta";

export const DEFAULT_BILL_PAGE_SIZE = 25;
export const MAX_BILL_PAGE_SIZE = 100;
export const MAX_BILL_PAGE = 10_000;
export const MAX_BILL_QUERY_LENGTH = 100;
export const MAX_BILL_JURISDICTION_FILTERS = 52;

/** Hard ceiling for a single export response. */
export const MAX_EXPORT_ROWS = 1000;

export const BILL_SORTS = ["newest", "oldest", "status", "state"] as const;
export type BillSort = (typeof BILL_SORTS)[number];

export interface BillQuery {
  q: string;
  jurisdictionCodes: string[];
  status: InstrumentStatus | null;
  type: InstrumentType | null;
  sort: BillSort;
  page: number;
  pageSize: number;
}

const CODE_PATTERN = /^[A-Z]{2}$/;

function parseCodes(value: string | null): string[] {
  if (!value) return [];
  const codes: string[] = [];
  for (const entry of value.split(",")) {
    const code = entry.trim().toUpperCase();
    if (!CODE_PATTERN.test(code) || codes.includes(code)) continue;
    codes.push(code);
    if (codes.length >= MAX_BILL_JURISDICTION_FILTERS) break;
  }
  return codes;
}

function parsePositiveInt(
  value: string | null,
  fallback: number,
  max: number
): number {
  const raw = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(raw, max);
}

/**
 * Parse the public bill-list query string.
 *
 * Invalid values fall back to the unfiltered default instead of erroring: this
 * is a shareable URL surface, and a typo in a link should still show data.
 * `q` is truncated rather than rejected for the same reason.
 */
export function parseBillQuery(params: URLSearchParams): BillQuery {
  const rawQuery = (params.get("q") ?? "").trim();
  const q = rawQuery.slice(0, MAX_BILL_QUERY_LENGTH);

  const rawStatus = params.get("status")?.trim().toUpperCase() ?? "";
  const status = isInstrumentStatus(rawStatus) ? rawStatus : null;

  const rawType = params.get("type")?.trim().toUpperCase() ?? "";
  const type = isInstrumentType(rawType) ? rawType : null;

  const rawSort = params.get("sort")?.trim().toLowerCase() ?? "";
  const sort = (BILL_SORTS as readonly string[]).includes(rawSort)
    ? (rawSort as BillSort)
    : "newest";

  return {
    q,
    jurisdictionCodes: parseCodes(params.get("jurisdiction")),
    status,
    type,
    sort,
    page: parsePositiveInt(params.get("page"), 1, MAX_BILL_PAGE),
    pageSize: parsePositiveInt(
      params.get("limit"),
      DEFAULT_BILL_PAGE_SIZE,
      MAX_BILL_PAGE_SIZE
    ),
  };
}

export type BillFilter = Pick<
  BillQuery,
  "q" | "jurisdictionCodes" | "status" | "type"
>;

/** True when at least one narrowing filter is active. */
export function hasBillFilters(filter: BillFilter): boolean {
  return (
    filter.q.length > 0 ||
    filter.jurisdictionCodes.length > 0 ||
    filter.status !== null ||
    filter.type !== null
  );
}

/**
 * Public listing predicate. `triageStatus: "RELEVANT"` is not optional:
 * unpublished candidates and rejected instruments never reach a public page or
 * export.
 */
export function billWhere(filter: BillFilter): Prisma.InstrumentWhereInput {
  const where: Prisma.InstrumentWhereInput = { triageStatus: "RELEVANT" };

  if (filter.q) {
    where.OR = [
      { title: { contains: filter.q, mode: "insensitive" } },
      { identifier: { contains: filter.q, mode: "insensitive" } },
      { rawSummary: { contains: filter.q, mode: "insensitive" } },
    ];
  }

  if (filter.jurisdictionCodes.length > 0) {
    where.jurisdiction = { code: { in: filter.jurisdictionCodes } };
  }

  if (filter.status) {
    where.status = filter.status;
  }

  if (filter.type) {
    where.type = filter.type;
  }

  return where;
}

/**
 * Undated rows sort last so a demo corpus without legislative dates never
 * pushes real, dated records off the first page.
 */
export function billOrderBy(
  sort: BillSort
): Prisma.InstrumentOrderByWithRelationInput[] {
  const newestFirst: Prisma.InstrumentOrderByWithRelationInput[] = [
    { introducedAt: { sort: "desc", nulls: "last" } },
    { createdAt: "desc" },
  ];

  switch (sort) {
    case "oldest":
      return [
        { introducedAt: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ];
    case "status":
      return [{ status: "asc" }, ...newestFirst];
    case "state":
      return [
        { jurisdiction: { code: "asc" } },
        { status: "asc" },
        { identifier: "asc" },
      ];
    case "newest":
    default:
      return newestFirst;
  }
}

/** Filter-only query string, shared by list links and export downloads. */
export function billFilterParams(filter: BillFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.jurisdictionCodes.length > 0) {
    params.set("jurisdiction", filter.jurisdictionCodes.join(","));
  }
  if (filter.status) params.set("status", filter.status);
  if (filter.type) params.set("type", filter.type);
  return params;
}

/** Page link for the list, dropping defaults so URLs stay short. */
export function billPageHref(query: BillQuery, page: number): string {
  const params = billFilterParams(query);
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (page > 1) params.set("page", String(page));
  if (query.pageSize !== DEFAULT_BILL_PAGE_SIZE) {
    params.set("limit", String(query.pageSize));
  }
  const qs = params.toString();
  return qs ? `/bills?${qs}` : "/bills";
}
