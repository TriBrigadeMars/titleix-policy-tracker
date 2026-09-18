import { prisma } from "@/lib/db";
import type { CellNote, Instrument, IssueTag, Jurisdiction } from "@/types";
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

function toInstrument(
  row: Prisma.InstrumentGetPayload<{ include: typeof instrumentInclude }>
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
