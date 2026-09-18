import { prisma } from "@/lib/db";
import type { Instrument } from "@/types";

/**
 * A raw instrument as produced by an ingest adapter, before jurisdiction codes
 * are resolved to database ids. Adapters know jurisdiction codes (e.g. "US"),
 * not the cuid primary keys used internally.
 */
export interface RawInstrument {
  jurisdictionCode: string;
  type: Instrument["type"];
  identifier: string;
  title: string;
  status: Instrument["status"];
  introducedAt: string | null;
  passedAt: string | null;
  effectiveAt: string | null;
  sourceUrl: string | null;
  rawSummary: string | null;
}

export type IngestOptions = Record<string, string | number>;

/**
 * An ingest adapter fetches raw instrument rows from an external source and
 * maps them to the source-agnostic {@link RawInstrument} shape. It does not
 * touch the database — that is {@link upsertInstruments}'s job.
 */
export interface IngestAdapter {
  readonly name: string;
  fetch(opts?: IngestOptions): Promise<RawInstrument[]>;
}

export interface IngestResult {
  total: number;
  upserted: number;
  skipped: number;
}

/**
 * Upsert raw instruments, resolving jurisdiction codes to ids and keying on the
 * unique `(jurisdictionId, type, identifier)`.
 *
 * Machine-owned fields (title, status, dates, sourceUrl, rawSummary,
 * lastCheckedAt) are overwritten on update. Editor-owned fields
 * (isTitleIXRelevant, relevanceConfidence) are never touched — that is human
 * triage, not ingest. Rows whose jurisdiction code is not in the database are
 * skipped and counted.
 */
export async function upsertInstruments(
  rows: RawInstrument[]
): Promise<IngestResult> {
  if (rows.length === 0) {
    return { total: 0, upserted: 0, skipped: 0 };
  }

  const codes = [...new Set(rows.map((r) => r.jurisdictionCode))];
  const jurisdictions = await prisma.jurisdiction.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const codeToId = new Map(jurisdictions.map((j) => [j.code, j.id]));

  // Attach the resolved jurisdiction id; drop rows whose code is unknown.
  const resolved = rows.flatMap((row) => {
    const jurisdictionId = codeToId.get(row.jurisdictionCode);
    if (!jurisdictionId) return [];
    return [{ ...row, jurisdictionId }];
  });

  const now = new Date();

  await prisma.$transaction(
    resolved.map((row) =>
      prisma.instrument.upsert({
        where: {
          jurisdictionId_type_identifier: {
            jurisdictionId: row.jurisdictionId,
            type: row.type,
            identifier: row.identifier,
          },
        },
        create: {
          jurisdictionId: row.jurisdictionId,
          type: row.type,
          identifier: row.identifier,
          title: row.title,
          status: row.status,
          introducedAt: row.introducedAt ? new Date(row.introducedAt) : null,
          passedAt: row.passedAt ? new Date(row.passedAt) : null,
          effectiveAt: row.effectiveAt ? new Date(row.effectiveAt) : null,
          sourceUrl: row.sourceUrl,
          rawSummary: row.rawSummary,
          lastCheckedAt: now,
          isTitleIXRelevant: false,
        },
        update: {
          title: row.title,
          status: row.status,
          introducedAt: row.introducedAt ? new Date(row.introducedAt) : null,
          passedAt: row.passedAt ? new Date(row.passedAt) : null,
          effectiveAt: row.effectiveAt ? new Date(row.effectiveAt) : null,
          sourceUrl: row.sourceUrl,
          rawSummary: row.rawSummary,
          lastCheckedAt: now,
        },
      })
    )
  );

  return {
    total: rows.length,
    upserted: resolved.length,
    skipped: rows.length - resolved.length,
  };
}
