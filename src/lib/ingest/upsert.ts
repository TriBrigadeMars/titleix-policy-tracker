import { prisma } from "@/lib/db";
import type { InstrumentStatus, InstrumentType } from "@/types";
import type { IngestResult, RawInstrument } from "./types";

type UpsertFields = {
  type: InstrumentType;
  identifier: string;
  title: string;
  status: InstrumentStatus;
  introducedAt: Date | null;
  passedAt: Date | null;
  effectiveAt: Date | null;
  sourceUrl: string | null;
  rawSummary: string | null;
  lastCheckedAt: Date;
};

function toUpsertFields(raw: RawInstrument): UpsertFields {
  const toDate = (iso: string | null) => (iso ? new Date(iso) : null);
  return {
    type: raw.type,
    identifier: raw.identifier,
    title: raw.title,
    status: raw.status,
    introducedAt: toDate(raw.introducedAt),
    passedAt: toDate(raw.passedAt),
    effectiveAt: toDate(raw.effectiveAt),
    sourceUrl: raw.sourceUrl,
    rawSummary: raw.rawSummary,
    lastCheckedAt: new Date(),
  };
}

/**
 * Upsert an array of `RawInstrument` rows into the Instrument table.
 *
 * - Resolves `jurisdictionCode` → `jurisdictionId` in one query.
 * - Upserts on the `(jurisdictionId, type, identifier)` unique key.
 * - On update, sets machine-known fields + `lastCheckedAt`. Does NOT touch
 *   `isTitleIXRelevant` or `relevanceConfidence` — those are editor-owned.
 * - Rows whose jurisdiction code is not in the database are skipped (counted).
 * - All upserts run inside a `$transaction` so a partial ingest does not leave
 *   the table half-updated.
 */
export async function upsertInstruments(
  raw: RawInstrument[]
): Promise<IngestResult> {
  if (raw.length === 0) {
    return { created: 0, updated: 0, skipped: 0, total: 0 };
  }

  const codes = [...new Set(raw.map((r) => r.jurisdictionCode))];
  const jurisdictions = await prisma.jurisdiction.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const codeToId = new Map(jurisdictions.map((j) => [j.code, j.id]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of raw) {
      const jurisdictionId = codeToId.get(row.jurisdictionCode);
      if (!jurisdictionId) {
        skipped++;
        continue;
      }

      const fields = toUpsertFields(row);

      const result = await tx.instrument.upsert({
        where: {
          jurisdictionId_type_identifier: {
            jurisdictionId,
            type: row.type,
            identifier: row.identifier,
          },
        },
        create: { jurisdictionId, ...fields },
        update: {
          type: fields.type,
          identifier: fields.identifier,
          title: fields.title,
          status: fields.status,
          introducedAt: fields.introducedAt,
          passedAt: fields.passedAt,
          effectiveAt: fields.effectiveAt,
          sourceUrl: fields.sourceUrl,
          rawSummary: fields.rawSummary,
          lastCheckedAt: fields.lastCheckedAt,
        },
        select: { id: true, createdAt: true, updatedAt: true },
      });

      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }
    }
  });

  return { created, updated, skipped, total: raw.length };
}
