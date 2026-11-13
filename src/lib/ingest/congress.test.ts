import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  congressAdapter,
  congressStatusFromLatestAction,
  mapCongressBills,
  ordinal,
} from "./congress";

const completeBill = {
  congress: 110,
  introducedDate: "2007-01-04",
  latestAction: {
    actionDate: "2007-04-26",
    text: "Sponsor introductory remarks on measure. (CR H4200)",
  },
  number: "10",
  originChamber: "House",
  originChamberCode: "H",
  title: "Expressing the sense of the Congress that ...",
  type: "HCONRES",
  updateDate: "2024-02-07",
  url: "https://api.congress.gov/v3/bill/110/hconres/10?format=json",
};

function response(...bills: unknown[]) {
  return { bills };
}

describe("ordinal", () => {
  it("formats ordinal suffixes correctly", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(101)).toBe("101st");
    expect(ordinal(111)).toBe("111th");
    expect(ordinal(119)).toBe("119th");
    expect(ordinal(121)).toBe("121st");
  });
});

describe("congressStatusFromLatestAction", () => {
  it("maps 'Became Public Law' to PASSED with passedAt flag (case-insensitive)", () => {
    expect(
      congressStatusFromLatestAction("Became Public Law No: 118-5.")
    ).toEqual({ status: "PASSED", passedAt: "use-action-date" });
    expect(
      congressStatusFromLatestAction("became public law no: 118-5.")
    ).toEqual({ status: "PASSED", passedAt: "use-action-date" });
  });

  it("maps 'Vetoed by President' and 'Pocket vetoed' to VETOED (case-insensitive)", () => {
    expect(
      congressStatusFromLatestAction("Vetoed by President.")
    ).toEqual({ status: "VETOED" });
    expect(
      congressStatusFromLatestAction("vetoed by president.")
    ).toEqual({ status: "VETOED" });
    expect(
      congressStatusFromLatestAction("Pocket vetoed by President.")
    ).toEqual({ status: "VETOED" });
    expect(
      congressStatusFromLatestAction("pocket vetoed.")
    ).toEqual({ status: "VETOED" });
  });

  it("maps 'Failed of passage' to FAILED (case-insensitive)", () => {
    expect(
      congressStatusFromLatestAction("Failed of passage in Senate.")
    ).toEqual({ status: "FAILED" });
    expect(
      congressStatusFromLatestAction(
        "On passage: Failed of passage by the Yeas and Nays."
      )
    ).toEqual({ status: "FAILED" });
    expect(
      congressStatusFromLatestAction("failed of passage.")
    ).toEqual({ status: "FAILED" });
  });

  it("maps undefined and unrelated strings to PROPOSED", () => {
    expect(congressStatusFromLatestAction(undefined)).toEqual({
      status: "PROPOSED",
    });
    expect(
      congressStatusFromLatestAction("Referred to the Committee on the Judiciary.")
    ).toEqual({ status: "PROPOSED" });
    expect(congressStatusFromLatestAction("")).toEqual({
      status: "PROPOSED",
    });
  });
});

describe("mapCongressBills", () => {
  it("maps a complete bill to the exact RawInstrument shape", () => {
    expect(mapCongressBills(response(completeBill))).toEqual([
      {
        jurisdictionCode: "US",
        type: "BILL",
        identifier: "HCONRES-10-110",
        source: "congress",
        sourceId: "HCONRES-10-110",
        title: "Expressing the sense of the Congress that ...",
        status: "PROPOSED",
        introducedAt: "2007-01-04",
        passedAt: null,
        effectiveAt: null,
        sourceUrl:
          "https://www.congress.gov/bill/110th-congress/house-concurrent-resolution/10",
        rawSummary: "Sponsor introductory remarks on measure. (CR H4200)",
      },
    ]);
  });

  it("maps absent optional fields to null", () => {
    const cases = [
      {
        name: "missing latestAction",
        bill: { ...completeBill, latestAction: undefined },
        field: "rawSummary",
      },
      {
        name: "latestAction without text",
        bill: { ...completeBill, latestAction: { actionDate: "2007-04-26" } },
        field: "rawSummary",
      },
      {
        name: "missing introducedDate",
        bill: { ...completeBill, introducedDate: undefined },
        field: "introducedAt",
      },
    ] as const;

    for (const { name, bill, field } of cases) {
      const rows = mapCongressBills(response(bill));
      expect(rows, name).toHaveLength(1);
      expect(rows[0][field], name).toBeNull();
    }
  });

  it("returns an empty array for an empty bills list", () => {
    expect(mapCongressBills({ bills: [] })).toEqual([]);
  });

  it("returns an empty array when the bills key is missing entirely", () => {
    expect(mapCongressBills({})).toEqual([]);
  });

  it("drops malformed bills instead of throwing", () => {
    const malformed = [
      { name: "missing type", bill: { congress: 110, number: "10" } },
      {
        name: "congress as a string",
        bill: { congress: "110", number: "10", type: "HCONRES" },
      },
      { name: "missing number", bill: { congress: 110, type: "HCONRES" } },
    ] as const;

    for (const { name, bill } of malformed) {
      expect(mapCongressBills(response(bill)), name).toEqual([]);
    }
  });

  it("keeps the good bill when mixed with a malformed one", () => {
    const rows = mapCongressBills(
      response(completeBill, { congress: 110, number: "11" })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).toBe("HCONRES-10-110");
  });

  it("maps multiple well-formed bills in order", () => {
    const second = {
      ...completeBill,
      congress: 119,
      type: "HR",
      number: "1234",
      title: "A later bill",
      introducedDate: undefined,
      latestAction: undefined,
    };
    const rows = mapCongressBills(response(completeBill, second));

    expect(rows).toHaveLength(2);
    expect(rows[0].identifier).toBe("HCONRES-10-110");
    expect(rows[0].introducedAt).toBe("2007-01-04");
    expect(rows[1]).toEqual({
      jurisdictionCode: "US",
      type: "BILL",
      identifier: "HR-1234-119",
      source: "congress",
      sourceId: "HR-1234-119",
      title: "A later bill",
      status: "PROPOSED",
      introducedAt: null,
      passedAt: null,
      effectiveAt: null,
      sourceUrl: "https://www.congress.gov/bill/119th-congress/house-bill/1234",
      rawSummary: null,
    });
  });

  it("drops a bill from another congress when requestedCongress is specified", () => {
    const bill118 = { ...completeBill, congress: 118, number: "1" };
    const bill119 = { ...completeBill, congress: 119, number: "2" };
    const rows = mapCongressBills(response(bill118, bill119), 119);
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).toBe("HCONRES-2-119");
  });

  it("maps a 'Became Public Law No: 118-5.' bill to PASSED with passedAt set", () => {
    const enactedBill = {
      ...completeBill,
      congress: 118,
      latestAction: {
        actionDate: "2023-06-03",
        text: "Became Public Law No: 118-5.",
      },
    };
    const [row] = mapCongressBills(response(enactedBill));
    expect(row.status).toBe("PASSED");
    expect(row.passedAt).toBe("2023-06-03");
  });

  it("maps all Congress bill types to their proper congress.gov URL slugs", () => {
    const typesToSlugs: Record<string, string> = {
      HR: "house-bill",
      S: "senate-bill",
      HJRES: "house-joint-resolution",
      SJRES: "senate-joint-resolution",
      HCONRES: "house-concurrent-resolution",
      SCONRES: "senate-concurrent-resolution",
      HRES: "house-resolution",
      SRES: "senate-resolution",
    };

    for (const [type, slug] of Object.entries(typesToSlugs)) {
      const bill = { ...completeBill, type, congress: 119, number: "42" };
      const [mapped] = mapCongressBills(response(bill));
      expect(mapped.sourceUrl).toBe(
        `https://www.congress.gov/bill/119th-congress/${slug}/42`
      );
    }
  });

  it("uses proper ordinal suffixes for sourceUrl (e.g. 121st)", () => {
    const bill121 = { ...completeBill, type: "HR", congress: 121, number: "1" };
    const [mapped] = mapCongressBills(response(bill121));
    expect(mapped.sourceUrl).toBe(
      "https://www.congress.gov/bill/121st-congress/house-bill/1"
    );
  });
});

describe("congressAdapter.fetch", () => {
  const originalKey = process.env.CONGRESS_GOV_API_KEY;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) {
      delete process.env.CONGRESS_GOV_API_KEY;
    } else {
      process.env.CONGRESS_GOV_API_KEY = originalKey;
    }
  });

  it("calls fetch with a URL whose path is /v3/bill/119 and which has no congress= query parameter", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => response({ ...completeBill, congress: 119 }),
    });

    await congressAdapter.fetch({ congress: 119, limit: 20 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/v3/bill/119");
    expect(parsed.searchParams.has("congress")).toBe(false);
  });

  it("drops bills from another congress returned by fetch", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";
    const bill118 = { ...completeBill, congress: 118, number: "1" };
    const bill119 = { ...completeBill, congress: 119, number: "2" };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => response(bill118, bill119),
    });

    const rows = await congressAdapter.fetch({ congress: 119 });
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).toBe("HCONRES-2-119");
  });

  it("rejects non-integer congress or limit before any network call", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";

    await expect(congressAdapter.fetch({ congress: 119.5 })).rejects.toThrow(
      /integer/i
    );
    await expect(
      congressAdapter.fetch({ congress: "abc" as unknown as number })
    ).rejects.toThrow(/integer/i);
    await expect(congressAdapter.fetch({ limit: 12.3 })).rejects.toThrow(
      /integer/i
    );
    await expect(
      congressAdapter.fetch({ limit: "xyz" as unknown as number })
    ).rejects.toThrow(/integer/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when CONGRESS_GOV_API_KEY is missing", async () => {
    delete process.env.CONGRESS_GOV_API_KEY;

    await expect(congressAdapter.fetch({})).rejects.toThrow(
      /CONGRESS_GOV_API_KEY is not set/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests with a timeout AbortSignal", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => response({ ...completeBill, congress: 119 }),
    });

    const rows = await congressAdapter.fetch({ congress: 119, limit: 20 });

    expect(rows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v3/bill/119");
    expect(url).toContain("limit=20");
    expect(url).not.toContain("offset=");
    expect(url).toContain("api_key=test-key");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("adds offset when paging", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => response({ ...completeBill, congress: 119 }),
    });

    await congressAdapter.fetch({ congress: 119, limit: 50, offset: 50 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("offset=50");
  });

  it("adds fromDateTime for an incremental fetch", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";
    fetchMock.mockResolvedValue({ ok: true, json: async () => response() });

    await congressAdapter.fetch({
      congress: 119,
      limit: 250,
      fromDateTime: "2026-11-11T12:00:00Z",
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(new URL(url).searchParams.get("fromDateTime")).toBe(
      "2026-11-11T12:00:00Z"
    );
  });

  it("omits fromDateTime when not given", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";
    fetchMock.mockResolvedValue({ ok: true, json: async () => response() });

    await congressAdapter.fetch({ congress: 119, limit: 250 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(new URL(url).searchParams.has("fromDateTime")).toBe(false);
  });

  it("rejects a fromDateTime in any other format before fetching", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";
    await expect(
      congressAdapter.fetch({ fromDateTime: "2026-11-11T12:00:00.000Z" })
    ).rejects.toThrow(/fromDateTime/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a non-ok response", async () => {
    process.env.CONGRESS_GOV_API_KEY = "test-key";
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    await expect(congressAdapter.fetch({})).rejects.toThrow(/status 503/);
  });
});
