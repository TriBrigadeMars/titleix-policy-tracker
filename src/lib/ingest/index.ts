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

export function parseSafeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Upsert raw instruments, resolving jurisdiction codes to ids and keying on the
 * unique `(jurisdictionId, type, identifier)`.
 *
 * Machine-owned fields (title, dates when valid, sourceUrl, rawSummary,
 * lastCheckedAt) are updated on re-ingest. Status is NOT overwritten on update
 * so editor and lifecycle corrections are preserved. Editor-owned triage fields
 * (triageStatus, isTitleIXRelevant, relevanceConfidence) are never touched on
 * update. Rows whose jurisdiction code is not in the database are skipped.
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
    resolved.map((row) => {
      const introducedAt = parseSafeDate(row.introducedAt);
      const passedAt = parseSafeDate(row.passedAt);
      const effectiveAt = parseSafeDate(row.effectiveAt);

      const updateData: Record<string, unknown> = {
        title: row.title,
        sourceUrl: row.sourceUrl,
        rawSummary: row.rawSummary,
        lastCheckedAt: now,
      };

      if (introducedAt) updateData.introducedAt = introducedAt;
      if (passedAt) updateData.passedAt = passedAt;
      if (effectiveAt) updateData.effectiveAt = effectiveAt;

      return prisma.instrument.upsert({
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
          triageStatus: "UNREVIEWED",
          isTitleIXRelevant: false,
          introducedAt,
          passedAt,
          effectiveAt,
          sourceUrl: row.sourceUrl,
          rawSummary: row.rawSummary,
          lastCheckedAt: now,
        },
        update: updateData,
      });
    })
  );

  return {
    total: rows.length,
    upserted: resolved.length,
    skipped: rows.length - resolved.length,
  };
}
