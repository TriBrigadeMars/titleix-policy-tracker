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
import type { Prisma } from "@prisma/client";

export const cellNoteInclude = {
  jurisdiction: true,
  issueTag: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.CellNoteInclude;

export const instrumentInclude = {
  jurisdiction: true,
  issueTags: { include: { issueTag: true } },
} satisfies Prisma.InstrumentInclude;

export const instrumentWithNotesInclude = {
  jurisdiction: true,
  issueTags: { include: { issueTag: true } },
  notes: {
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.InstrumentInclude;

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

export function toInstrument(
  row: Prisma.InstrumentGetPayload<{ include: typeof instrumentInclude }> & {
    notes?: {
      id: string;
      instrumentId: string;
      authorId: string;
      body: string;
      createdAt: Date;
      updatedAt: Date;
      author: { id: string; name: string | null };
    }[];
  }
): Instrument {
  return {
    id: row.id,
    jurisdictionId: row.jurisdictionId,
    type: row.type,
    identifier: row.identifier,
    title: row.title,
    status: row.status,
    introducedAt: iso(row.introducedAt),
    passedAt: iso(row.passedAt),
    effectiveAt: iso(row.effectiveAt),
    sourceUrl: row.sourceUrl,
    rawSummary: row.rawSummary,
    isTitleIXRelevant: row.isTitleIXRelevant,
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
      author: { id: n.author.id, name: n.author.name },
    })),
  };
}

function toCellNote(
  row: Prisma.CellNoteGetPayload<{ include: typeof cellNoteInclude }>
): CellNote {
  return {
    id: row.id,
    jurisdictionId: row.jurisdictionId,
    issueTagId: row.issueTagId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    jurisdiction: toJurisdiction(row.jurisdiction),
    issueTag: toIssueTag(row.issueTag),
    author: { id: row.author.id, name: row.author.name },
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
    isTitleIXRelevant: true,
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

  if (input.relevance === "relevant") {
    where.isTitleIXRelevant = true;
  } else if (input.relevance === "not_relevant") {
    where.isTitleIXRelevant = false;
    where.relevanceConfidence = { not: null };
  } else if (input.relevance === "unreviewed") {
    where.isTitleIXRelevant = false;
    where.relevanceConfidence = null;
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
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: input.limit ?? 50,
  });

  return rows.map(toInstrument);
}

export async function getInstrumentById(id: string): Promise<Instrument | null> {
  const row = await prisma.instrument.findUnique({
    where: { id },
    include: instrumentWithNotesInclude,
  });
  return row ? toInstrument(row) : null;
}

export async function getHeatmapSummaries(): Promise<HeatmapSummary[]> {
  const [jurisdictions, relevantGroups, pendingGroups, tagLinks, noteGroups] =
    await Promise.all([
      prisma.jurisdiction.findMany({
        orderBy: [{ level: "asc" }, { code: "asc" }],
      }),
      prisma.instrument.groupBy({
        by: ["jurisdictionId"],
        where: { isTitleIXRelevant: true },
        _count: { id: true },
      }),
      prisma.instrument.groupBy({
        by: ["jurisdictionId"],
        where: { isTitleIXRelevant: true, status: "PROPOSED" },
        _count: { id: true },
      }),
      // Fetch issue-tag links for relevant instruments to count distinct tags per jurisdiction
      prisma.instrumentIssueTag.findMany({
        where: { instrument: { isTitleIXRelevant: true } },
        select: {
          issueTagId: true,
          instrument: { select: { jurisdictionId: true } },
        },
      }),
      prisma.cellNote.groupBy({
        by: ["jurisdictionId"],
        _count: { id: true },
      }),
    ]);

  // Count distinct issue tags per jurisdiction
  const issueTagSets = new Map<string, Set<string>>();
  for (const link of tagLinks) {
    const jId = link.instrument.jurisdictionId;
    let s = issueTagSets.get(jId);
    if (!s) {
      s = new Set();
      issueTagSets.set(jId, s);
    }
    s.add(link.issueTagId);
  }

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
    issueTagCount: issueTagSets.get(j.id)?.size ?? 0,
    cellNoteCount: noteMap.get(j.id) ?? 0,
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

export async function getUserById(id: string): Promise<UserSummary | null> {
  const row = await prisma.user.findUnique({
    where: { id },
    select: userSummarySelect,
  });
  return row ? toUserSummary(row) : null;
}


