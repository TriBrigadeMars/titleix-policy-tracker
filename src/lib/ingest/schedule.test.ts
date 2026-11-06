import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawInstrument } from "@/lib/ingest";

const { congressFetch, openStatesFetch, legiscanFetch, runIngest, recordSkippedIngest } =
  vi.hoisted(() => ({
    congressFetch: vi.fn(),
    openStatesFetch: vi.fn(),
    legiscanFetch: vi.fn(),
    runIngest: vi.fn(),
    recordSkippedIngest: vi.fn(),
  }));

vi.mock("@/lib/ingest/congress", () => ({
  congressAdapter: { name: "congress.gov", fetch: congressFetch },
}));
vi.mock("@/lib/ingest/openstates", () => ({
  openStatesAdapter: { name: "openstates", fetch: openStatesFetch },
}));
vi.mock("@/lib/ingest/legiscan", () => ({
  legiScanAdapter: { name: "legiscan", fetch: legiscanFetch },
}));
vi.mock("@/lib/ingest/pipeline", () => ({
  runIngest,
  recordSkippedIngest,
  classifyIngestError: (error: unknown) =>
    error instanceof Error && /is not set/.test(error.message)
      ? "MissingApiKey"
      : "Unknown",
}));

import {
  fetchCongressUntilCap,
  fetchOpenStatesUntilCap,
  runScheduledIngest,
  scheduledIngestConfigFromEnv,
} from "./schedule";

function bill(identifier: string): RawInstrument {
  return {
    jurisdictionCode: "US",
    type: "BILL",
    identifier,
    title: "Title IX bill",
    status: "PROPOSED",
    introducedAt: null,
    passedAt: null,
    effectiveAt: null,
    sourceUrl: null,
    rawSummary: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runIngest.mockImplementation(async (_source: string, fetchRows: () => Promise<RawInstrument[]>) => {
    const rows = await fetchRows();
    return {
      total: rows.length,
      upserted: rows.length,
      skipped: 0,
      dropped: 0,
      runId: "run-1",
    };
  });
});

describe("scheduledIngestConfigFromEnv", () => {
  it("uses explicit caps and the default OpenStates list", () => {
    const previous = { ...process.env };
    delete process.env.INGEST_OPENSTATES_JURISDICTIONS;
    delete process.env.LEGISCAN_SESSION_ID;
    process.env.INGEST_CONGRESS = "119";
    process.env.INGEST_CONGRESS_LIMIT = "80";
    const config = scheduledIngestConfigFromEnv();
    expect(config.congressCap).toBe(80);
    expect(config.openStatesJurisdictions).toEqual(["ca", "tx"]);
    expect(config.legiscanSessionId).toBeUndefined();
    process.env = previous;
  });
});

describe("fetchCongressUntilCap", () => {
  it("pages with offset until the cap", async () => {
    congressFetch
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => bill(`a-${i}`)))
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => bill(`b-${i}`)));

    const rows = await fetchCongressUntilCap(119, 100);
    expect(rows).toHaveLength(100);
    expect(congressFetch).toHaveBeenNthCalledWith(1, {
      congress: 119,
      limit: 50,
      offset: 0,
    });
    expect(congressFetch).toHaveBeenNthCalledWith(2, {
      congress: 119,
      limit: 50,
      offset: 50,
    });
  });
});

describe("fetchOpenStatesUntilCap", () => {
  it("pages until a short page", async () => {
    openStatesFetch
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => bill(`p1-${i}`)))
      .mockResolvedValueOnce([bill("p2-0")]);

    const rows = await fetchOpenStatesUntilCap("ca", 80);
    expect(rows).toHaveLength(51);
    expect(openStatesFetch).toHaveBeenNthCalledWith(2, {
      jurisdiction: "ca",
      limit: 50,
      page: 2,
    });
  });
});

describe("runScheduledIngest", () => {
  it("requires a LegiScan session id and still runs the other sources", async () => {
    congressFetch.mockResolvedValue([bill("c-1")]);
    openStatesFetch.mockResolvedValue([bill("o-1")]);

    const results = await runScheduledIngest({
      congress: 119,
      congressCap: 10,
      openStatesJurisdictions: ["ca"],
      openStatesCap: 10,
      legiscanCap: 10,
    });

    expect(recordSkippedIngest).toHaveBeenCalledWith("legiscan", "MissingSessionId");
    expect(legiscanFetch).not.toHaveBeenCalled();
    expect(results.map((r) => r.source)).toEqual([
      "congress.gov",
      "openstates:ca",
      "legiscan",
    ]);
    expect(results[2]).toMatchObject({ ok: false, errorClass: "MissingSessionId" });
  });

  it("passes the session id and cap to LegiScan", async () => {
    congressFetch.mockResolvedValue([]);
    openStatesFetch.mockResolvedValue([]);
    legiscanFetch.mockResolvedValue([bill("l-1")]);

    await runScheduledIngest({
      congress: 119,
      congressCap: 1,
      openStatesJurisdictions: [],
      openStatesCap: 1,
      legiscanSessionId: "1541",
      legiscanCap: 25,
    });

    expect(legiscanFetch).toHaveBeenCalledWith({ id: "1541", limit: 25 });
  });
});
