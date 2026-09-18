import type { InstrumentStatus, InstrumentType } from "@/types";

/**
 * Source-agnostic shape produced by an ingest adapter and consumed by the
 * upsert function. The adapter maps from a specific API (Congress.gov,
 * LegiScan, …) into this; the upsert function only knows this + Prisma.
 *
 * `jurisdictionCode` is the Jurisdiction `code` column ("US", "CA", …), not
 * the database id — the upsert resolves codes to ids in one query.
 */
export interface RawInstrument {
  jurisdictionCode: string;
  type: InstrumentType;
  identifier: string;
  title: string;
  status: InstrumentStatus;
  introducedAt: string | null;
  passedAt: string | null;
  effectiveAt: string | null;
  sourceUrl: string | null;
  rawSummary: string | null;
}

/**
 * A source adapter. `fetch` pulls raw rows from an external API and maps them
 * to `RawInstrument[]`. No database access lives here — that is the upsert
 * function's job.
 */
export interface IngestAdapter {
  readonly name: string;
  fetch(): Promise<RawInstrument[]>;
}

export interface IngestResult {
  created: number;
  updated: number;
  skipped: number;
  total: number;
}
