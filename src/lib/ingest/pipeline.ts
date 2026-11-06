import { prisma } from "@/lib/db";
import { upsertInstruments, type RawInstrument } from "./index";
import { selectCandidates } from "./candidate-filter";

export interface IngestPipelineResult {
  total: number;
  upserted: number;
  skipped: number;
  dropped: number;
  runId: string;
}

export function classifyIngestError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
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
 * Fetch, drop non-candidates, upsert, and persist a run record. Fetch and
 * write failures are recorded as FAILED with an error class (never the raw
 * message, which can carry keys or URLs) and then rethrown.
 */
export async function runIngest(
  source: string,
  fetchRows: () => Promise<RawInstrument[]>
): Promise<IngestPipelineResult> {
  const run = await prisma.ingestRun.create({
    data: { source, status: "RUNNING" },
  });

  try {
    const rows = await fetchRows();
    const { kept, dropped } = selectCandidates(rows);
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
      total: rows.length,
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
