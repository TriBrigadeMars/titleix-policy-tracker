import type { RawInstrument } from "@/lib/ingest";
import { congressAdapter } from "@/lib/ingest/congress";
import { legiScanAdapter } from "@/lib/ingest/legiscan";
import { openStatesAdapter } from "@/lib/ingest/openstates";
import {
  classifyIngestError,
  recordSkippedIngest,
  runIngest,
  type IngestPipelineResult,
} from "@/lib/ingest/pipeline";

export const DEFAULT_CONGRESS = 119;
export const DEFAULT_CONGRESS_CAP = 100;
export const DEFAULT_OPENSTATES_CAP = 50;
export const DEFAULT_OPENSTATES_PAGE = 50;
export const DEFAULT_LEGISCAN_CAP = 100;
export const DEFAULT_OPENSTATES_JURISDICTIONS = ["ca", "tx"] as const;

export interface ScheduledIngestConfig {
  congress: number;
  congressCap: number;
  openStatesJurisdictions: string[];
  openStatesCap: number;
  legiscanSessionId?: string;
  legiscanCap: number;
}

export interface ScheduledSourceResult {
  source: string;
  ok: boolean;
  result?: IngestPipelineResult;
  errorClass?: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envList(name: string, fallback: readonly string[]): string[] {
  const raw = process.env[name];
  if (!raw?.trim()) return [...fallback];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function scheduledIngestConfigFromEnv(): ScheduledIngestConfig {
  const session = process.env.LEGISCAN_SESSION_ID?.trim();
  return {
    congress: envInt("INGEST_CONGRESS", DEFAULT_CONGRESS),
    congressCap: envInt("INGEST_CONGRESS_LIMIT", DEFAULT_CONGRESS_CAP),
    openStatesJurisdictions: envList(
      "INGEST_OPENSTATES_JURISDICTIONS",
      DEFAULT_OPENSTATES_JURISDICTIONS
    ),
    openStatesCap: envInt("INGEST_OPENSTATES_CAP", DEFAULT_OPENSTATES_CAP),
    legiscanSessionId: session || undefined,
    legiscanCap: envInt("INGEST_LEGISCAN_LIMIT", DEFAULT_LEGISCAN_CAP),
  };
}

export async function fetchCongressUntilCap(
  congress: number,
  cap: number
) {
  const pageSize = Math.min(50, cap);
  const rows = [];
  let offset = 0;
  while (rows.length < cap) {
    const batch = await congressAdapter.fetch({
      congress,
      limit: pageSize,
      offset,
    });
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += batch.length;
  }
  return rows.slice(0, cap);
}

export async function fetchOpenStatesUntilCap(
  jurisdiction: string,
  cap: number
) {
  const perPage = Math.min(DEFAULT_OPENSTATES_PAGE, cap);
  const rows = [];
  let page = 1;
  while (rows.length < cap) {
    const batch = await openStatesAdapter.fetch({
      jurisdiction,
      limit: perPage,
      page,
    });
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return rows.slice(0, cap);
}

/**
 * Call each existing adapter with explicit caps. One source failing does not
 * skip the rest. Missing keys fail closed inside the adapters and leave a run
 * record via {@link runIngest}.
 */
export async function runScheduledIngest(
  config: ScheduledIngestConfig
): Promise<ScheduledSourceResult[]> {
  const results: ScheduledSourceResult[] = [];

  results.push(
    await runOne("congress.gov", () =>
      fetchCongressUntilCap(config.congress, config.congressCap)
    )
  );

  for (const jurisdiction of config.openStatesJurisdictions) {
    const source = `openstates:${jurisdiction}`;
    results.push(
      await runOne(source, () =>
        fetchOpenStatesUntilCap(jurisdiction, config.openStatesCap)
      )
    );
  }

  if (!config.legiscanSessionId) {
    await recordSkippedIngest("legiscan", "MissingSessionId");
    results.push({
      source: "legiscan",
      ok: false,
      errorClass: "MissingSessionId",
    });
  } else {
    const sessionId = config.legiscanSessionId;
    results.push(
      await runOne("legiscan", () =>
        legiScanAdapter.fetch({
          id: sessionId,
          limit: config.legiscanCap,
        })
      )
    );
  }

  return results;
}

async function runOne(
  source: string,
  fetchRows: () => Promise<RawInstrument[]>
): Promise<ScheduledSourceResult> {
  try {
    const result = await runIngest(source, fetchRows);
    return { source, ok: true, result };
  } catch (error) {
    console.error(`[ingest:${source}] failed`, error);
    return { source, ok: false, errorClass: classifyIngestError(error) };
  }
}
