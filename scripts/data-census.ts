/**
 * Phase 0 data census for MVP baseline (see docs/MVP-PLAN.md).
 *
 * Run with DATABASE_URL pointing at a migrated database:
 *   npx tsx scripts/data-census.ts
 *
 * Requires: prisma generate, schema applied (migrate deploy).
 */
import { PrismaClient } from "@prisma/client";
import { findProbableDuplicates } from "../src/lib/ingest/probable-duplicates";

const prisma = new PrismaClient();

async function main() {
  const [
    triageRows,
    instrumentTotal,
    relevantWithTag,
    relevantWithoutTag,
    jurisdictionsWithLastChecked,
    lastCheckedBounds,
    cellNotesByTag,
    cellNoteTotal,
    jurisdictionCount,
    issueTagCatalogCount,
    distinctTagsOnRelevant,
  ] = await Promise.all([
    prisma.instrument.groupBy({
      by: ["triageStatus"],
      _count: { id: true },
    }),
    prisma.instrument.count(),
    prisma.instrument.count({
      where: {
        triageStatus: "RELEVANT",
        issueTags: { some: {} },
      },
    }),
    prisma.instrument.count({
      where: {
        triageStatus: "RELEVANT",
        issueTags: { none: {} },
      },
    }),
    prisma.instrument.groupBy({
      by: ["jurisdictionId"],
      where: { lastCheckedAt: { not: null } },
      _count: { id: true },
    }),
    prisma.instrument.aggregate({
      _min: { lastCheckedAt: true },
      _max: { lastCheckedAt: true },
    }),
    prisma.cellNote.groupBy({
      by: ["issueTagId"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.cellNote.count(),
    prisma.jurisdiction.count(),
    prisma.issueTag.count(),
    prisma.instrumentIssueTag.findMany({
      where: { instrument: { triageStatus: "RELEVANT" } },
      distinct: ["issueTagId"],
      select: { issueTagId: true },
    }),
  ]);

  const triage = Object.fromEntries(
    triageRows.map((r) => [r.triageStatus, r._count.id])
  ) as Record<string, number>;

  const tagRowsWithSlug = await prisma.issueTag.findMany({
    where: {
      id: { in: cellNotesByTag.map((r) => r.issueTagId) },
    },
    select: { id: true, slug: true, label: true },
  });
  const slugById = new Map(tagRowsWithSlug.map((t) => [t.id, t.slug]));

  const lines: string[] = [];
  const stamp = new Date().toISOString();
  lines.push(`# Data census (${stamp})`);
  lines.push("");
  lines.push("## Catalog");
  lines.push(`- jurisdictions: ${jurisdictionCount}`);
  lines.push(`- issue tags (catalog): ${issueTagCatalogCount}`);
  lines.push(`- instruments (total): ${instrumentTotal}`);
  lines.push(`- cell notes (total): ${cellNoteTotal}`);
  lines.push("");
  lines.push("## Instruments by triage status");
  for (const s of ["UNREVIEWED", "RELEVANT", "NOT_RELEVANT"] as const) {
    lines.push(`- ${s}: ${triage[s] ?? 0}`);
  }
  lines.push("");
  lines.push("## Issue-tag coverage (RELEVANT instruments only)");
  lines.push(`- with ≥1 issue tag: ${relevantWithTag}`);
  lines.push(`- with 0 issue tags: ${relevantWithoutTag}`);
  lines.push(
    `- distinct issue tags attached to at least one RELEVANT instrument: ${distinctTagsOnRelevant.length}`
  );
  lines.push("");
  lines.push("## lastCheckedAt");
  lines.push(
    `- jurisdictions with ≥1 instrument where lastCheckedAt IS NOT NULL: ${jurisdictionsWithLastChecked.length}`
  );
  lines.push(
    `- min(lastCheckedAt) among all instruments: ${lastCheckedBounds._min.lastCheckedAt?.toISOString() ?? "null"}`
  );
  lines.push(
    `- max(lastCheckedAt) among all instruments: ${lastCheckedBounds._max.lastCheckedAt?.toISOString() ?? "null"}`
  );
  lines.push("");
  lines.push("## Cell notes per issue tag (descending count)");
  if (cellNotesByTag.length === 0) {
    lines.push("- (none)");
  } else {
    for (const row of cellNotesByTag) {
      const slug = slugById.get(row.issueTagId) ?? row.issueTagId;
      lines.push(`- ${slug}: ${row._count.id}`);
    }
  }

  const duplicates = findProbableDuplicates(await prisma.instrument.findMany({
    where: { type: "BILL", source: { not: null } },
    select: { id: true, jurisdictionId: true, identifier: true, source: true, jurisdiction: { select: { code: true } } },
    orderBy: [{ jurisdictionId: "asc" }, { identifier: "asc" }, { id: "asc" }],
  }));
  lines.push("", "## Probable cross-source duplicate bills (review only)");
  lines.push("Same jurisdiction and normalized bill-number suffix; sessions may differ. No rows are modified.");
  if (!duplicates.length) lines.push("- (none)");
  for (const [left, right] of duplicates) {
    lines.push(`- ${left.jurisdiction.code}: ${left.source} ${left.identifier} [${left.id}] ↔ ${right.source} ${right.identifier} [${right.id}]`);
  }

  // Machine-readable block for diffing
  const json = {
    generatedAt: stamp,
    probableCrossSourceDuplicates: duplicates,
    jurisdictions: jurisdictionCount,
    issueTagsCatalog: issueTagCatalogCount,
    instrumentsTotal: instrumentTotal,
    instrumentsByTriage: triage,
    relevantWithIssueTag: relevantWithTag,
    relevantWithoutIssueTag: relevantWithoutTag,
    distinctIssueTagsOnRelevant: distinctTagsOnRelevant.length,
    jurisdictionsWithAnyLastCheckedAt: jurisdictionsWithLastChecked.length,
    lastCheckedAtMin: lastCheckedBounds._min.lastCheckedAt?.toISOString() ?? null,
    lastCheckedAtMax: lastCheckedBounds._max.lastCheckedAt?.toISOString() ?? null,
    cellNotesTotal: cellNoteTotal,
    cellNotesByIssueTag: cellNotesByTag.map((r) => ({
      issueTagId: r.issueTagId,
      slug: slugById.get(r.issueTagId) ?? null,
      count: r._count.id,
    })),
  };

  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(json, null, 2));
  lines.push("```");

  console.log(lines.join("\n"));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
