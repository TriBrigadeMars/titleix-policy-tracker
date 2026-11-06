import { prisma } from "@/lib/db";
import type {
  CellNote,
  HeatmapSummary,
  Instrument,
  InstrumentStatus,
  IssueTag,
  Jurisdiction,
  UserSummary,
} from "@/types";
import type { UserRole } from "@/lib/roles";
import type { TriageRelevanceFilter, UserListQuery } from "@/lib/search-params";
import { triageWhere } from "@/lib/triage";
import type { Prisma } from "@prisma/client";

export const cellNoteInclude = {
  jurisdiction: true,
  issueTag: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.CellNoteInclude;

export const instrumentNoteInclude = {
  author: { select: { id: true, name: true } },
} satisfies Prisma.InstrumentNoteInclude;

export const instrumentInclude = {
  jurisdiction: true,
  issueTags: { include: { issueTag: true } },
} satisfies Prisma.InstrumentInclude;

export const instrumentWithNotesInclude = {
  jurisdiction: true,
  issueTags: { include: { issueTag: true } },
  notes: {
    include: instrumentNoteInclude,
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.InstrumentInclude;

/**
 * Widening of the no-notes payload used by comparison views: `notes` is absent
 * there but present (ordered) on triage/editor rows. Access stays
 * optional-chained so both shapes flow through `toInstrument`.
 */
type InstrumentRow = Prisma.InstrumentGetPayload<{
  include: typeof instrumentInclude;
}> & {
  notes?: Prisma.InstrumentNoteGetPayload<{
    include: typeof instrumentNoteInclude;
  }>[];
};

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toJurisdiction(row: {
  id: string;
  code: string;
  name: string;
  level: Jurisdiction["level"];
}): Jurisdiction {
  return { id: row.id, code: row.code, name: row.name, level: row.level };
}

function toIssueTag(row: {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
  description: string | null;
}): IssueTag {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    sortOrder: row.sortOrder,
    description: row.description,
  };
}

export function toInstrument(row: InstrumentRow): Instrument {
  return {
    id: row.id,
    jurisdictionId: row.jurisdictionId,
    type: row.type,
    identifier: row.identifier,
    title: row.title,
    status: row.status,
    triageStatus: row.triageStatus,
    source: row.source,
    sourceId: row.sourceId,
    introducedAt: iso(row.introducedAt),
    passedAt: iso(row.passedAt),
    effectiveAt: iso(row.effectiveAt),
    sourceUrl: row.sourceUrl,
    rawSummary: row.rawSummary,
    relevanceConfidence: row.relevanceConfidence,
    jurisdiction: toJurisdiction(row.jurisdiction),
    issueTags: row.issueTags.map((link) => ({
      issueTag: toIssueTag(link.issueTag),
    })),
    notes: row.notes?.map((n) => ({
      id: n.id,
      instrumentId: n.instrumentId,
      authorId: n.authorId,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      author: n.author ? { id: n.author.id, name: n.author.name } : null,
    })),
  };
}

export function toCellNote(
  row: Prisma.CellNoteGetPayload<{ include: typeof cellNoteInclude }>
): CellNote {
  return {
    id: row.id,
    jurisdictionId: row.jurisdictionId,
    issueTagId: row.issueTagId,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    jurisdiction: toJurisdiction(row.jurisdiction),
    issueTag: toIssueTag(row.issueTag),
    author: row.author ? { id: row.author.id, name: row.author.name } : null,
  };
}

export async function getJurisdictions(): Promise<Jurisdiction[]> {
  const rows = await prisma.jurisdiction.findMany({
    orderBy: [{ level: "asc" }, { code: "asc" }],
  });
  return rows.map(toJurisdiction);
}

export async function getIssueTags(): Promise<IssueTag[]> {
  const rows = await prisma.issueTag.findMany({
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(toIssueTag);
}

export function instrumentComparisonWhere(input: {
  jurisdictionIds: string[];
  issueTagIds: string[];
}): Prisma.InstrumentWhereInput {
  const where: Prisma.InstrumentWhereInput = {
    jurisdictionId: { in: input.jurisdictionIds },
    triageStatus: "RELEVANT",
  };

  if (input.issueTagIds.length > 0) {
    where.issueTags = {
      some: { issueTagId: { in: input.issueTagIds } },
    };
  }

  return where;
}

export function cellNoteComparisonWhere(input: {
  jurisdictionIds: string[];
  issueTagIds: string[];
}): Prisma.CellNoteWhereInput {
  const where: Prisma.CellNoteWhereInput = {
    jurisdictionId: { in: input.jurisdictionIds },
  };

  if (input.issueTagIds.length > 0) {
    where.issueTagId = { in: input.issueTagIds };
  }

  return where;
}

export async function getInstrumentsForComparison(input: {
  jurisdictionIds: string[];
  issueTagIds?: string[];
}): Promise<Instrument[]> {
  const rows = await prisma.instrument.findMany({
    where: instrumentComparisonWhere({
      jurisdictionIds: input.jurisdictionIds,
      issueTagIds: input.issueTagIds ?? [],
    }),
    include: instrumentInclude,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map(toInstrument);
}

export async function getCellNotesForComparison(input: {
  jurisdictionIds: string[];
  issueTagIds?: string[];
}): Promise<CellNote[]> {
  const rows = await prisma.cellNote.findMany({
    where: cellNoteComparisonWhere({
      jurisdictionIds: input.jurisdictionIds,
      issueTagIds: input.issueTagIds ?? [],
    }),
    include: cellNoteInclude,
  });
  return rows.map(toCellNote);
}

const FALLBACK_DEFAULT_STATE_CODES = ["CA", "TX"] as const;

/**
 * Cold-open comparison when `?j=` is absent: federal plus two states. Prefers
 * two state jurisdictions that already have relevant instruments; otherwise
 * falls back to CA and TX when those rows exist.
 */
export async function getDefaultComparisonCodes(
  jurisdictions: Jurisdiction[]
): Promise<string[]> {
  const byCode = new Map(jurisdictions.map((j) => [j.code, j]));
  const federal = byCode.get("US");

  const stateList = jurisdictions.filter((j) => j.level === "STATE");

  const counts = await prisma.instrument.groupBy({
    by: ["jurisdictionId"],
    where: { triageStatus: "RELEVANT" },
    _count: { id: true },
  });
  const countById = new Map(
    counts.map((c) => [c.jurisdictionId, c._count.id])
  );

  const statesWithData = stateList
    .filter((j) => (countById.get(j.id) ?? 0) > 0)
    .sort(
      (a, b) =>
        (countById.get(b.id) ?? 0) - (countById.get(a.id) ?? 0)
    );

  const picked = new Map<string, Jurisdiction>();

  for (const j of statesWithData) {
    if (picked.size >= 2) break;
    picked.set(j.code, j);
  }

  if (picked.size < 2) {
    for (const code of FALLBACK_DEFAULT_STATE_CODES) {
      const j = byCode.get(code);
      if (j && j.level === "STATE" && !picked.has(code)) {
        picked.set(code, j);
      }
      if (picked.size >= 2) break;
    }
  }

  if (picked.size < 2) {
    for (const j of stateList) {
      if (!picked.has(j.code)) picked.set(j.code, j);
      if (picked.size >= 2) break;
    }
  }

  const stateCodes = [...picked.keys()].slice(0, 2);

  if (federal && stateCodes.length >= 2) {
    return ["US", ...stateCodes];
  }
  if (federal && stateCodes.length === 1) {
    return ["US", stateCodes[0]];
  }
  if (stateCodes.length >= 2) {
    return stateCodes.slice(0, 2);
  }
  if (federal) {
    const one =
      stateCodes[0] ?? stateList.find((j) => j.code !== "US")?.code;
    return one ? ["US", one] : [federal.code];
  }
  return stateCodes;
}

export function instrumentTriageWhere(input: {
  jurisdictionId?: string;
  status?: InstrumentStatus;
  relevance: TriageRelevanceFilter;
}): Prisma.InstrumentWhereInput {
  const where: Prisma.InstrumentWhereInput = {};

  if (input.jurisdictionId) {
    where.jurisdictionId = input.jurisdictionId;
  }

  if (input.status) {
    where.status = input.status;
  }

  if (input.relevance === "relevant_untagged") {
    where.triageStatus = "RELEVANT";
    where.issueTags = { none: {} };
    return where;
  }

  if (input.relevance !== "all") {
    Object.assign(where, triageWhere(input.relevance));
  }

  return where;
}

export async function getInstrumentsForTriage(input: {
  jurisdictionCode?: string;
  status?: InstrumentStatus;
  relevance: TriageRelevanceFilter;
  limit?: number;
}): Promise<Instrument[]> {
  let jurisdictionId: string | undefined;

  if (input.jurisdictionCode) {
    const jur = await prisma.jurisdiction.findUnique({
      where: { code: input.jurisdictionCode },
      select: { id: true },
    });
    if (!jur) return [];
    jurisdictionId = jur.id;
  }

  const rows = await prisma.instrument.findMany({
    where: instrumentTriageWhere({
      jurisdictionId,
      status: input.status,
      relevance: input.relevance,
    }),
    include: instrumentWithNotesInclude,
    orderBy: [{ lastCheckedAt: "desc" }, { createdAt: "desc" }],
    take: input.limit ?? 50,
  });

  return rows.map(toInstrument);
}

export interface TriageQueueCounts {
  unreviewed: number;
  relevantUntagged: number;
}

export async function getTriageQueueCounts(): Promise<TriageQueueCounts> {
  const [unreviewed, relevantUntagged] = await Promise.all([
    prisma.instrument.count({ where: { triageStatus: "UNREVIEWED" } }),
    prisma.instrument.count({
      where: { triageStatus: "RELEVANT", issueTags: { none: {} } },
    }),
  ]);
  return { unreviewed, relevantUntagged };
}

export interface PublicFreshness {
  lastSuccessfulRunAt: string | null;
  lastSuccessfulSource: string | null;
  lastFailedRunAt: string | null;
  lastFailedErrorClass: string | null;
  oldestLastCheckedAt: string | null;
  newestLastCheckedAt: string | null;
}

/**
 * Freshness is a stored ingest run when one exists. Instrument timestamps are
 * the fallback for a fixture-only database that has not run adapters yet.
 */
export async function getPublicFreshness(): Promise<PublicFreshness> {
  const [successful, failed, oldest, newest] = await Promise.all([
    prisma.ingestRun.findFirst({
      where: { status: "SUCCESS", finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true, source: true },
    }),
    prisma.ingestRun.findFirst({
      where: { status: "FAILED", finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true, errorClass: true },
    }),
    prisma.instrument.findFirst({
      where: { lastCheckedAt: { not: null } },
      orderBy: { lastCheckedAt: "asc" },
      select: { lastCheckedAt: true },
    }),
    prisma.instrument.findFirst({
      where: { lastCheckedAt: { not: null } },
      orderBy: { lastCheckedAt: "desc" },
      select: { lastCheckedAt: true },
    }),
  ]);

  return {
    lastSuccessfulRunAt: successful?.finishedAt?.toISOString() ?? null,
    lastSuccessfulSource: successful?.source ?? null,
    lastFailedRunAt: failed?.finishedAt?.toISOString() ?? null,
    lastFailedErrorClass: failed?.errorClass ?? null,
    oldestLastCheckedAt: oldest?.lastCheckedAt?.toISOString() ?? null,
    newestLastCheckedAt: newest?.lastCheckedAt?.toISOString() ?? null,
  };
}


export async function getHeatmapSummaries(): Promise<HeatmapSummary[]> {
  const [
    jurisdictions,
    relevantGroups,
    pendingGroups,
    tagCounts,
    noteGroups,
    issueTagCount,
  ] = await Promise.all([
    prisma.jurisdiction.findMany({
      orderBy: [{ level: "asc" }, { code: "asc" }],
    }),
    prisma.instrument.groupBy({
      by: ["jurisdictionId"],
      where: { triageStatus: "RELEVANT" },
      _count: { id: true },
    }),
    prisma.instrument.groupBy({
      by: ["jurisdictionId"],
      where: { triageStatus: "RELEVANT", status: "PROPOSED" },
      _count: { id: true },
    }),
    // Distinct issue tags per jurisdiction, aggregated in SQL. Loading every
    // link row into memory does not scale with the instrument table.
    prisma.$queryRaw<{ jurisdiction_id: string; tag_count: bigint }[]>`
        SELECT i.jurisdiction_id, COUNT(DISTINCT iit.issue_tag_id) AS tag_count
        FROM instrument_issue_tags iit
        JOIN instruments i ON i.id = iit.instrument_id
        WHERE i.triage_status = 'RELEVANT'
        GROUP BY i.jurisdiction_id
      `,
    prisma.cellNote.groupBy({
      by: ["jurisdictionId"],
      _count: { id: true },
    }),
    prisma.issueTag.count(),
  ]);

  const tagCountMap = new Map(
    tagCounts.map((row) => [row.jurisdiction_id, Number(row.tag_count)])
  );

  const relevantMap = new Map(
    relevantGroups.map((g) => [g.jurisdictionId, g._count.id])
  );
  const pendingMap = new Map(
    pendingGroups.map((g) => [g.jurisdictionId, g._count.id])
  );
  const noteMap = new Map(
    noteGroups.map((g) => [g.jurisdictionId, g._count.id])
  );

  return jurisdictions.map((j) => ({
    jurisdictionId: j.id,
    jurisdiction: toJurisdiction(j),
    relevantCount: relevantMap.get(j.id) ?? 0,
    pendingCount: pendingMap.get(j.id) ?? 0,
    issueTagCount: tagCountMap.get(j.id) ?? 0,
    cellNoteCount: noteMap.get(j.id) ?? 0,
    totalIssueTags: issueTagCount,
  }));
}

export const userSummarySelect = {
  id: true,
  email: true,
  name: true,
  image: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export function toUserSummary(row: {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}): UserSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function userListWhere(input: {
  search?: string;
  role?: UserRole;
}): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};

  if (input.role) {
    where.role = input.role;
  }

  if (input.search) {
    where.OR = [
      { name: { contains: input.search, mode: "insensitive" } },
      { email: { contains: input.search, mode: "insensitive" } },
    ];
  }

  return where;
}

export async function getUsers(
  input: UserListQuery
): Promise<UserSummary[]> {
  const rows = await prisma.user.findMany({
    where: userListWhere({ search: input.search, role: input.role }),
    select: userSummarySelect,
    orderBy: [{ role: "desc" }, { createdAt: "desc" }],
    take: input.limit ?? 50,
  });
  return rows.map(toUserSummary);
}



