import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawInstrument } from "@/lib/ingest";
import type { CandidateScan } from "@/lib/ingest/candidate-filter";

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
  getLastSuccessfulRunAt: vi.fn(),
  classifyIngestError: (error: unknown) =>
    error instanceof Error && /is not set/.test(error.message)
      ? "MissingApiKey"
      : "Unknown",
}));

import {
  CONGRESS_PAGE_SIZE,
  DEFAULT_MAX_PAGES_PER_SOURCE,
  DEFAULT_OPENSTATES_CAP,
  OPENSTATES_PAGE_DELAY_MS,
  OPENSTATES_PAGE_SIZE,
  fetchCongressUntilCap,
  fetchLegiScanUntilCap,
  fetchOpenStatesUntilCap,
  runScheduledIngest,
  scanForCandidates,
  scheduledIngestConfigFromEnv,
  toCongressDateTime,
  toOpenStatesDateTime,
  type ScheduleDeps,
  type ScheduledIngestConfig,
} from "./schedule";

function bill(identifier: string, title = "Highway funding authorization"): RawInstrument {
  return {
    jurisdictionCode: "US",
    type: "BILL",
    identifier,
    title,
    status: "PROPOSED",
    introducedAt: null,
    passedAt: null,
    effectiveAt: null,
    sourceUrl: null,
    rawSummary: null,
  };
}

function match(identifier: string): RawInstrument {
  return bill(identifier, "Title IX athletics eligibility");
}

/** A full page of non-matching rows. */
function noise(prefix: string, size: number): RawInstrument[] {
  return Array.from({ length: size }, (_, i) => bill(`${prefix}-${i}`));
}

const noSleep = vi.fn(async () => {});

function deps(overrides: Partial<ScheduleDeps> = {}): ScheduleDeps {
  return {
    sleep: noSleep,
    lastSuccessfulRunAt: vi.fn(async () => null),
    ...overrides,
  };
}

function config(overrides: Partial<ScheduledIngestConfig> = {}): ScheduledIngestConfig {
  return {
    congress: 119,
    congressCap: 10,
    openStatesJurisdictions: [],
    openStatesCap: 10,
    legiscanCap: 10,
    maxPagesPerSource: 5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runIngest.mockImplementation(
    async (_source: string, fetchCandidates: () => Promise<CandidateScan>) => {
      const { kept, scanned } = await fetchCandidates();
      return {
        total: scanned,
        upserted: kept.length,
        skipped: 0,
        dropped: scanned - kept.length,
        runId: "run-1",
      };
    }
  );
});

describe("scheduledIngestConfigFromEnv", () => {
  it("uses explicit caps and the default OpenStates list", () => {
    const previous = { ...process.env };
    delete process.env.INGEST_OPENSTATES_JURISDICTIONS;
    delete process.env.LEGISCAN_SESSION_ID;
    delete process.env.INGEST_MAX_PAGES;
    process.env.INGEST_CONGRESS = "119";
    process.env.INGEST_CONGRESS_LIMIT = "80";
    const config = scheduledIngestConfigFromEnv();
    expect(config.congressCap).toBe(80);
    expect(config.openStatesJurisdictions).toEqual(["ca", "tx"]);
    expect(config.legiscanSessionId).toBeUndefined();
    expect(config.maxPagesPerSource).toBe(DEFAULT_MAX_PAGES_PER_SOURCE);
    process.env = previous;
  });

  it("reads the page budget from INGEST_MAX_PAGES", () => {
    const previous = { ...process.env };
    process.env.INGEST_MAX_PAGES = "7";
    expect(scheduledIngestConfigFromEnv().maxPagesPerSource).toBe(7);
    process.env = previous;
  });
});

describe("date formats", () => {
  const at = new Date("2026-11-12T08:30:15.123Z");

  it("formats Congress.gov fromDateTime as YYYY-MM-DDTHH:MM:SSZ", () => {
    expect(toCongressDateTime(at)).toBe("2026-11-12T08:30:15Z");
  });

  it("formats OpenStates updated_since without Z or milliseconds", () => {
    expect(toOpenStatesDateTime(at)).toBe("2026-11-12T08:30:15");
  });
});

describe("scanForCandidates", () => {
  it("keeps matches that only appear on page 4 of 5", async () => {
    const fetchPage = vi.fn(async (i: number) =>
      i === 3 ? [...noise("p4", 48), match("m-1"), match("m-2")] : noise(`p${i + 1}`, 50)
    );

    const scan = await scanForCandidates({
      fetchPage,
      pageSize: 50,
      cap: 50,
      maxPages: 5,
    });

    expect(scan.kept.map((r) => r.identifier)).toEqual(["m-1", "m-2"]);
    expect(scan.scanned).toBe(250);
    expect(scan.stopReason).toBe("budget");
  });

  it("stops at the page budget even when nothing matches", async () => {
    const fetchPage = vi.fn(async (i: number) => noise(`p${i}`, 20));

    const scan = await scanForCandidates({
      fetchPage,
      pageSize: 20,
      cap: 50,
      maxPages: 3,
    });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(scan).toMatchObject({ kept: [], scanned: 60, pages: 3, stopReason: "budget" });
  });

  it("stops once kept rows reach the cap and makes no further request", async () => {
    const fetchPage = vi.fn(async (i: number) => [
      match(`m-${i}-a`),
      match(`m-${i}-b`),
      ...noise(`p${i}`, 18),
    ]);

    const scan = await scanForCandidates({
      fetchPage,
      pageSize: 20,
      cap: 3,
      maxPages: 10,
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(scan.kept).toHaveLength(3);
    expect(scan.stopReason).toBe("cap");
  });

  it("stops on a short page", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(noise("p1", 20))
      .mockResolvedValueOnce([match("m-1")]);

    const scan = await scanForCandidates({
      fetchPage,
      pageSize: 20,
      cap: 50,
      maxPages: 10,
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(scan).toMatchObject({ scanned: 21, stopReason: "exhausted" });
  });

  it("waits between pages through the injected sleep, not before the first", async () => {
    const sleep = vi.fn(async () => {});
    const fetchPage = vi.fn(async (i: number) => noise(`p${i}`, 20));

    await scanForCandidates({
      fetchPage,
      pageSize: 20,
      cap: 50,
      maxPages: 3,
      delayMs: 1_000,
      sleep,
    });

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });
});

describe("fetchCongressUntilCap", () => {
  it("pages by offset at the documented maximum page size", async () => {
    congressFetch
      .mockResolvedValueOnce(noise("a", CONGRESS_PAGE_SIZE))
      .mockResolvedValueOnce([match("m-1")]);

    const scan = await fetchCongressUntilCap(119, 100, { maxPages: 20 });

    expect(scan.kept).toHaveLength(1);
    expect(scan.scanned).toBe(CONGRESS_PAGE_SIZE + 1);
    expect(congressFetch).toHaveBeenNthCalledWith(1, {
      congress: 119,
      limit: CONGRESS_PAGE_SIZE,
      offset: 0,
    });
    expect(congressFetch).toHaveBeenNthCalledWith(2, {
      congress: 119,
      limit: CONGRESS_PAGE_SIZE,
      offset: CONGRESS_PAGE_SIZE,
    });
  });

  it("passes fromDateTime when a previous run exists", async () => {
    congressFetch.mockResolvedValue([]);
    await fetchCongressUntilCap(119, 100, {
      maxPages: 20,
      since: new Date("2026-11-11T12:00:00.500Z"),
    });
    expect(congressFetch).toHaveBeenCalledWith({
      congress: 119,
      limit: CONGRESS_PAGE_SIZE,
      offset: 0,
      fromDateTime: "2026-11-11T12:00:00Z",
    });
  });
});

describe("fetchOpenStatesUntilCap", () => {
  it("finds matches on page 4 that the default cap used to cut off", async () => {
    // Each page returns as many rows as requested; only page 4 has matches.
    openStatesFetch.mockImplementation(async (opts: { page: number; limit: number }) =>
      opts.page === 4
        ? [match("ca-match"), ...noise("p4", opts.limit - 1)]
        : noise(`p${opts.page}`, opts.limit)
    );

    const scan = await fetchOpenStatesUntilCap("ca", DEFAULT_OPENSTATES_CAP, {
      maxPages: DEFAULT_MAX_PAGES_PER_SOURCE,
      sleep: noSleep,
    });

    expect(scan.kept.map((r) => r.identifier)).toContain("ca-match");
  });

  it("requests newest-updated first at the vendor's page size and waits between pages", async () => {
    openStatesFetch
      .mockResolvedValueOnce(noise("p1", OPENSTATES_PAGE_SIZE))
      .mockResolvedValueOnce([match("m-1")]);
    const sleep = vi.fn(async () => {});

    await fetchOpenStatesUntilCap("ca", 80, { maxPages: 20, sleep });

    expect(openStatesFetch).toHaveBeenNthCalledWith(1, {
      jurisdiction: "ca",
      limit: OPENSTATES_PAGE_SIZE,
      page: 1,
      sort: "updated_desc",
    });
    expect(openStatesFetch).toHaveBeenNthCalledWith(2, {
      jurisdiction: "ca",
      limit: OPENSTATES_PAGE_SIZE,
      page: 2,
      sort: "updated_desc",
    });
    expect(sleep).toHaveBeenCalledWith(OPENSTATES_PAGE_DELAY_MS);
  });

  it("passes updatedSince only when a previous run exists", async () => {
    openStatesFetch.mockResolvedValue([]);
    await fetchOpenStatesUntilCap("ca", 80, {
      maxPages: 20,
      sleep: noSleep,
      since: new Date("2026-11-11T12:00:00Z"),
    });
    expect(openStatesFetch).toHaveBeenCalledWith(
      expect.objectContaining({ updatedSince: "2026-11-11T12:00:00" })
    );
  });
});

describe("fetchLegiScanUntilCap", () => {
  it("keeps a match at position 5,000 of the master list", async () => {
    // Honour `limit` like the real adapter does, so a pre-filter cap would
    // truncate the list before the match is seen.
    legiscanFetch.mockImplementation(async (opts: { limit?: number }) => {
      const rows = [...noise("ls", 4_999), match("CA-AB5000"), ...noise("tail", 1_000)];
      return opts.limit ? rows.slice(0, opts.limit) : rows;
    });

    const scan = await fetchLegiScanUntilCap("1541", 100);

    expect(legiscanFetch).toHaveBeenCalledWith({ id: "1541" });
    expect(scan.kept.map((r) => r.identifier)).toEqual(["CA-AB5000"]);
    expect(scan.scanned).toBe(6_000);
  });

  it("applies the cap to kept rows after filtering", async () => {
    legiscanFetch.mockResolvedValue([
      ...noise("ls", 10),
      ...Array.from({ length: 5 }, (_, i) => match(`m-${i}`)),
    ]);

    const scan = await fetchLegiScanUntilCap("1541", 2);

    expect(scan.kept.map((r) => r.identifier)).toEqual(["m-0", "m-1"]);
    expect(scan.scanned).toBe(15);
  });
});

describe("runScheduledIngest", () => {
  it("requires a LegiScan session id and still runs the other sources", async () => {
    congressFetch.mockResolvedValue([match("c-1")]);
    openStatesFetch.mockResolvedValue([match("o-1")]);

    const results = await runScheduledIngest(
      config({ openStatesJurisdictions: ["ca"] }),
      deps()
    );

    expect(recordSkippedIngest).toHaveBeenCalledWith("legiscan", "MissingSessionId");
    expect(legiscanFetch).not.toHaveBeenCalled();
    expect(results.map((r) => r.source)).toEqual([
      "congress.gov:119",
      "openstates:ca",
      "legiscan",
    ]);
    expect(results[2]).toMatchObject({ ok: false, errorClass: "MissingSessionId" });
  });

  it("passes the session id to LegiScan without a pre-filter limit", async () => {
    congressFetch.mockResolvedValue([]);
    legiscanFetch.mockResolvedValue([match("l-1")]);

    await runScheduledIngest(config({ legiscanSessionId: "1541", legiscanCap: 25 }), deps());

    expect(legiscanFetch).toHaveBeenCalledWith({ id: "1541" });
  });

  it("uses each source's last successful run as its since-filter", async () => {
    congressFetch.mockResolvedValue([]);
    openStatesFetch.mockResolvedValue([]);
    const lastSuccessfulRunAt = vi.fn(async (source: string) =>
      source === "openstates:ca" ? new Date("2026-11-11T12:00:00Z") : null
    );

    await runScheduledIngest(
      config({ openStatesJurisdictions: ["ca"] }),
      deps({ lastSuccessfulRunAt })
    );

    expect(lastSuccessfulRunAt).toHaveBeenCalledWith("congress.gov:119");
    expect(lastSuccessfulRunAt).toHaveBeenCalledWith("openstates:ca");
    // No previous Congress run: no filter.
    expect(congressFetch).toHaveBeenCalledWith(
      expect.not.objectContaining({ fromDateTime: expect.anything() })
    );
    expect(openStatesFetch).toHaveBeenCalledWith(
      expect.objectContaining({ updatedSince: "2026-11-11T12:00:00" })
    );
  });

  it("reports scanned and kept so dropped stays meaningful", async () => {
    congressFetch.mockResolvedValue([match("c-1"), bill("c-2"), bill("c-3")]);

    const [congress] = await runScheduledIngest(config(), deps());

    expect(congress.result).toMatchObject({ total: 3, upserted: 1, dropped: 2 });
  });
});
