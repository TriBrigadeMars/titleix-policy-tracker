import { prisma } from "@/lib/db";
import { upsertInstruments } from "./index";
import type { CandidateScan } from "./candidate-filter";

export type { CandidateScan } from "./candidate-filter";

export interface IngestPipelineResult {
  total: number;
  upserted: number;
  skipped: number;
  dropped: number;
  runId: string;
}

export function classifyIngestError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/SourceOverlap/.test(message)) return "SourceOverlap";
  if (/UnmappableResponse/.test(message)) return "UnmappableResponse";
  if (/is not set/i.test(message)) return "MissingApiKey";
  if (/session id/i.test(message)) return "MissingSessionId";
  if (/requires an explicit jurisdiction/i.test(message)) {
    return "MissingJurisdiction";
  }
  if (/timeout|aborted|AbortError/i.test(message)) return "UpstreamTimeout";
  if (/request failed|returned an error|status 5\d\d/i.test(message)) {
    return "UpstreamError";
  }
  if (/P20\d{2}|prisma|database/i.test(message)) return "DatabaseError";
  return "Unknown";
}

/**
 * Fetch already-filtered candidates, upsert them, and persist a run record.
 * Filtering belongs to the fetch step so that caps apply to kept rows, never to
 * raw rows before the keyword filter. Fetch and write failures are recorded as
 * FAILED with an error class (never the raw message, which can carry keys or
 * URLs) and then rethrown.
 */
export async function runIngest(
  source: string,
  fetchCandidates: () => Promise<CandidateScan>
): Promise<IngestPipelineResult> {
  const run = await prisma.ingestRun.create({
    data: { source, status: "RUNNING" },
  });

  try {
    const { kept, scanned } = await fetchCandidates();
    const dropped = Math.max(0, scanned - kept.length);
    const result = await upsertInstruments(kept);
    const finished = await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        upserted: result.upserted,
        skipped: result.skipped,
        dropped,
      },
    });
    return {
      total: scanned,
      upserted: result.upserted,
      skipped: result.skipped,
      dropped,
      runId: finished.id,
    };
  } catch (error) {
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorClass: classifyIngestError(error),
      },
    });
    throw error;
  }
}

export async function recordSkippedIngest(
  source: string,
  errorClass: string
): Promise<void> {
  const now = new Date();
  await prisma.ingestRun.create({
    data: {
      source,
      status: "FAILED",
      startedAt: now,
      finishedAt: now,
      errorClass,
    },
  });
}

/**
 * Start time of the newest successful run for `source`, or null if there is
 * none. The start time (not the finish time) is the safe lower bound for the
 * next incremental fetch: anything updated while that run was in flight is
 * picked up again rather than missed.
 */
export async function getLastSuccessfulRunAt(
  source: string
): Promise<Date | null> {
  const run = await prisma.ingestRun.findFirst({
    where: { source, status: "SUCCESS", finishedAt: { not: null } },
    orderBy: { finishedAt: "desc" },
    select: { startedAt: true },
  });
  return run?.startedAt ?? null;
}
