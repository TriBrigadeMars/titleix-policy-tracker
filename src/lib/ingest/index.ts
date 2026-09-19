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
  source?: string | null;
  sourceId?: string | null;
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

/** Upstream fetch calls are capped so a hung API cannot stall an ingest. */
export const FETCH_TIMEOUT_MS = 10_000;

export function parseSafeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Rows per `$transaction`. A single unbounded transaction over a whole master
 * list (LegiScan returns tens of thousands of rows) can exceed statement and
 * lock timeouts, so upserts are batched.
 */
export const INGEST_CHUNK_SIZE = 50;

export function chunk<T>(items: T[], size = INGEST_CHUNK_SIZE): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function upsertOperation(
  row: RawInstrument & { jurisdictionId: string },
  now: Date
) {
  const introducedAt = parseSafeDate(row.introducedAt);
  const passedAt = parseSafeDate(row.passedAt);
  const effectiveAt = parseSafeDate(row.effectiveAt);

  const updateData: Record<string, unknown> = {
    title: row.title,
    // Source-owned lifecycle status: refreshed on every re-ingest so a bill
    // that moved from PROPOSED to PASSED upstream is not frozen locally.
    status: row.status,
    sourceUrl: row.sourceUrl,
    rawSummary: row.rawSummary,
    lastCheckedAt: now,
  };

  if (row.source !== undefined) updateData.source = row.source;
  if (row.sourceId !== undefined) updateData.sourceId = row.sourceId;
  // Dates are source-owned and `null` means "the source did not report this
  // date", not "clear it". A reported date always overwrites; an absent one
  // leaves the previously known value intact.
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
      source: row.source ?? null,
      sourceId: row.sourceId ?? null,
      introducedAt,
      passedAt,
      effectiveAt,
      sourceUrl: row.sourceUrl,
      rawSummary: row.rawSummary,
      lastCheckedAt: now,
    },
    update: updateData,
  });
}

/**
 * Upsert raw instruments, resolving jurisdiction codes to ids and keying on the
 * unique `(jurisdictionId, type, identifier)`.
 *
 * Machine-owned fields (title, status, dates when the source reports them,
 * sourceUrl, rawSummary, lastCheckedAt) are updated on re-ingest. Ingestion
 * owns `status`: it is the source-of-record lifecycle state and is refreshed
 * every time, so a bill that advanced upstream is not frozen locally. There is
 * no editorial status override in the product, so no override layer is needed.
 * Editor-owned triage fields (triageStatus, relevanceConfidence) are never
 * touched on update. Rows whose jurisdiction code is not in the database are
 * skipped.
 *
 * Writes are batched into {@link INGEST_CHUNK_SIZE}-row `$transaction`s, and
 * each chunk commits on its own. A chunk that throws leaves earlier chunks
 * committed and the error is rethrown (never swallowed) so callers still fail
 * loudly. That is safe because the write is idempotent — it keys on
 * `(jurisdictionId, type, identifier)` and the update path only rewrites
 * source-owned fields — so retrying the same ingest converges instead of
 * duplicating rows.
 *
 * Rows are resolved and mapped one chunk at a time rather than as one array of
 * every pending operation, so a full-session ingest (LegiScan returns tens of
 * thousands of rows) does not hold several copies of the whole batch in memory.
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

  const now = new Date();
  let upserted = 0;

  for (const batch of chunk(rows)) {
    // Resolve jurisdiction ids per chunk; drop rows whose code is unknown.
    const operations = batch.flatMap((row) => {
      const jurisdictionId = codeToId.get(row.jurisdictionCode);
      if (!jurisdictionId) return [];
      upserted += 1;
      return [upsertOperation({ ...row, jurisdictionId }, now)];
    });

    if (operations.length === 0) continue;
    await prisma.$transaction(operations);
  }

  return {
    total: rows.length,
    upserted,
    skipped: rows.length - upserted,
  };
}
