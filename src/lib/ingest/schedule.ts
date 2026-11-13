import type { RawInstrument } from "@/lib/ingest";
import {
  filterCandidates,
  selectCandidates,
  type CandidateScan,
} from "@/lib/ingest/candidate-filter";
import { congressAdapter } from "@/lib/ingest/congress";
import { legiScanAdapter } from "@/lib/ingest/legiscan";
import { openStatesAdapter } from "@/lib/ingest/openstates";
import {
  classifyIngestError,
  getLastSuccessfulRunAt,
  recordSkippedIngest,
  runIngest,
  type IngestPipelineResult,
} from "@/lib/ingest/pipeline";

export const DEFAULT_CONGRESS = 119;
/** Caps count kept (Title IX candidate) rows, not raw rows fetched. */
export const DEFAULT_CONGRESS_CAP = 100;
export const DEFAULT_OPENSTATES_CAP = 50;
export const DEFAULT_LEGISCAN_CAP = 100;
export const DEFAULT_OPENSTATES_JURISDICTIONS = ["ca", "tx"] as const;
/** Upper bound on pages requested per source per run. */
export const DEFAULT_MAX_PAGES_PER_SOURCE = 20;

/** Congress.gov documents a maximum `limit` of 250 for the bill list. */
export const CONGRESS_PAGE_SIZE = 250;
/** OpenStates v3 rejects `per_page` above 20 for `/bills`. */
export const OPENSTATES_PAGE_SIZE = 20;
/** Minimum gap between OpenStates page requests. */
export const OPENSTATES_PAGE_DELAY_MS = 1_000;

export interface ScheduledIngestConfig {
  congress: number;
  congressCap: number;
  openStatesJurisdictions: string[];
  openStatesCap: number;
  legiscanSessionId?: string;
  legiscanCap: number;
  maxPagesPerSource: number;
}

export interface ScheduledSourceResult {
  source: string;
  ok: boolean;
  result?: IngestPipelineResult;
  errorClass?: string;
}

/** Injectable side effects so tests neither sleep nor touch the database. */
export interface ScheduleDeps {
  sleep: (ms: number) => Promise<void>;
  lastSuccessfulRunAt: (source: string) => Promise<Date | null>;
}

const defaultDeps: ScheduleDeps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  lastSuccessfulRunAt: getLastSuccessfulRunAt,
};

export type ScanStopReason = "cap" | "budget" | "exhausted";

export interface ScanResult extends CandidateScan {
  pages: number;
  stopReason: ScanStopReason;
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
    maxPagesPerSource: envInt("INGEST_MAX_PAGES", DEFAULT_MAX_PAGES_PER_SOURCE),
  };
}

/** `2026-11-12T08:30:00Z` — the Congress.gov `fromDateTime` format. */
export function toCongressDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** `2026-11-12T08:30:00` (UTC) — what OpenStates' `updated_since` parses. */
export function toOpenStatesDateTime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

/**
 * Request pages one at a time, filtering each as it arrives, until the kept
 * cap is reached, the page budget is spent, or a short page shows the source
 * has nothing more. Every call is bounded by `maxPages`.
 */
export async function scanForCandidates(opts: {
  fetchPage: (pageIndex: number) => Promise<RawInstrument[]>;
  pageSize: number;
  cap: number;
  maxPages: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ScanResult> {
  const { fetchPage, pageSize, cap, maxPages, delayMs = 0 } = opts;
  const sleep = opts.sleep ?? defaultDeps.sleep;
  const kept: RawInstrument[] = [];
  let scanned = 0;
  let pages = 0;

  while (pages < maxPages) {
    if (pages > 0 && delayMs > 0) await sleep(delayMs);
    const batch = await fetchPage(pages);
    pages += 1;
    scanned += batch.length;

    for (const row of selectCandidates(batch).kept) {
      if (kept.length >= cap) break;
      kept.push(row);
    }
    if (kept.length >= cap) {
      return { kept, scanned, pages, stopReason: "cap" };
    }
    if (batch.length < pageSize) {
      return { kept, scanned, pages, stopReason: "exhausted" };
    }
  }
  return { kept, scanned, pages, stopReason: "budget" };
}

/**
 * Congress.gov has no documented sort parameter on `/bill/{congress}` (it
 * returns bills by latest action date), so incremental runs rely on
 * `fromDateTime`, which filters by update date server-side.
 */
export async function fetchCongressUntilCap(
  congress: number,
  cap: number,
  opts: { maxPages: number; since?: Date | null; sleep?: ScheduleDeps["sleep"] }
): Promise<ScanResult> {
  const fromDateTime = opts.since ? toCongressDateTime(opts.since) : undefined;
  return scanForCandidates({
    pageSize: CONGRESS_PAGE_SIZE,
    cap,
    maxPages: opts.maxPages,
    sleep: opts.sleep,
    fetchPage: (pageIndex) =>
      congressAdapter.fetch({
        congress,
        limit: CONGRESS_PAGE_SIZE,
        offset: pageIndex * CONGRESS_PAGE_SIZE,
        ...(fromDateTime ? { fromDateTime } : {}),
      }),
  });
}

/** Newest-updated first, optionally limited to bills updated since `since`. */
export async function fetchOpenStatesUntilCap(
  jurisdiction: string,
  cap: number,
  opts: {
    maxPages: number;
    since?: Date | null;
    sleep?: ScheduleDeps["sleep"];
    delayMs?: number;
  }
): Promise<ScanResult> {
  const updatedSince = opts.since ? toOpenStatesDateTime(opts.since) : undefined;
  return scanForCandidates({
    pageSize: OPENSTATES_PAGE_SIZE,
    cap,
    maxPages: opts.maxPages,
    delayMs: opts.delayMs ?? OPENSTATES_PAGE_DELAY_MS,
    sleep: opts.sleep,
    fetchPage: (pageIndex) =>
      openStatesAdapter.fetch({
        jurisdiction,
        limit: OPENSTATES_PAGE_SIZE,
        page: pageIndex + 1,
        sort: "updated_desc",
        ...(updatedSince ? { updatedSince } : {}),
      }),
  });
}

/**
 * `getMasterList` is one response for the whole session, so filter every row
 * first and only then apply the cap to what was kept.
 */
export async function fetchLegiScanUntilCap(
  sessionId: string,
  cap: number
): Promise<CandidateScan> {
  const { kept, scanned } = filterCandidates(
    await legiScanAdapter.fetch({ id: sessionId })
  );
  return { kept: kept.slice(0, cap), scanned };
}

/**
 * Call each existing adapter with explicit caps. One source failing does not
 * skip the rest. Missing keys fail closed inside the adapters and leave a run
 * record via {@link runIngest}.
 *
 * Run records for Congress.gov carry the congress number so that a since-filter
 * from one congress is never applied to another, and so that a one-page admin
 * ingest (recorded as plain `congress.gov`) never advances the scheduled
 * cursor.
 */
export async function runScheduledIngest(
  config: ScheduledIngestConfig,
  deps: ScheduleDeps = defaultDeps
): Promise<ScheduledSourceResult[]> {
  const results: ScheduledSourceResult[] = [];
  const maxPages = config.maxPagesPerSource;

  const congressSource = `congress.gov:${config.congress}`;
  results.push(
    await runOne(congressSource, async () =>
      fetchCongressUntilCap(config.congress, config.congressCap, {
        maxPages,
        since: await deps.lastSuccessfulRunAt(congressSource),
        sleep: deps.sleep,
      })
    )
  );

  for (const jurisdiction of config.openStatesJurisdictions) {
    const source = `openstates:${jurisdiction}`;
    results.push(
      await runOne(source, async () =>
        fetchOpenStatesUntilCap(jurisdiction, config.openStatesCap, {
          maxPages,
          since: await deps.lastSuccessfulRunAt(source),
          sleep: deps.sleep,
        })
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
        fetchLegiScanUntilCap(sessionId, config.legiscanCap)
      )
    );
  }

  return results;
}

async function runOne(
  source: string,
  fetchCandidates: () => Promise<CandidateScan>
): Promise<ScheduledSourceResult> {
  try {
    const result = await runIngest(source, fetchCandidates);
    return { source, ok: true, result };
  } catch (error) {
    console.error(`[ingest:${source}] failed`, error);
    return { source, ok: false, errorClass: classifyIngestError(error) };
  }
}
