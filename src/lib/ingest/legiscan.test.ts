import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  legiScanAdapter,
  mapLegiScanMasterList,
  mapLegiScanMasterListBatches,
} from "./legiscan";

const completeItem = {
  bill_id: 12345,
  number: "AB1",
  status: "1",
  status_date: "2023-01-11",
  last_action: "Introduced and referred to committee",
  last_action_date: "2023-01-11",
  title: "An act relating to student safety",
  description: "Relating to Title IX protections",
  url: "https://legiscan.com/CA/bill/AB1/2023",
  state: "CA",
};

function response(masterlist: Record<string, unknown>) {
  return { status: "OK", masterlist };
}

function masterlist(...items: unknown[]) {
  const out: Record<string, unknown> = {};
  items.forEach((item, i) => {
    out[String(i)] = item;
  });
  return out;
}

describe("mapLegiScanMasterList", () => {
  it("maps a complete master-list item to the exact RawInstrument shape", () => {
    const json = response({
      ...masterlist(completeItem),
      session: {
        session_id: 1541,
        session_tag: "20232024",
        session_name: "2023-2024 Regular Session",
      },
    });
    expect(mapLegiScanMasterList(json)).toEqual([
      {
        jurisdictionCode: "CA",
        type: "BILL",
        identifier: "CA-20232024-AB1",
        source: "legiscan",
        sourceId: "12345",
        title: "An act relating to student safety",
        status: "PROPOSED",
        introducedAt: "2023-01-11",
        passedAt: null,
        effectiveAt: null,
        sourceUrl: "https://legiscan.com/CA/bill/AB1/2023",
        rawSummary: "Introduced and referred to committee",
      },
    ]);
  });

  it("maps numeric status 4 to PASSED with the status date as passedAt and sets introducedAt from available date", () => {
    const item = { ...completeItem, status: 4, status_date: "2023-08-01" };
    const row = mapLegiScanMasterList(response(masterlist(item)))[0];
    expect(row.status).toBe("PASSED");
    expect(row.passedAt).toBe("2023-08-01");
    expect(row.introducedAt).toBe("2023-08-01");
  });

  it("maps chaptered status 8 to EFFECTIVE", () => {
    const item = { ...completeItem, status: 8 };
    expect(mapLegiScanMasterList(response(masterlist(item)))[0].status).toBe(
      "EFFECTIVE"
    );
  });

  it("maps vetoed status 5 to REPEALED", () => {
    const item = { ...completeItem, status: 5 };
    expect(mapLegiScanMasterList(response(masterlist(item)))[0].status).toBe(
      "REPEALED"
    );
  });

  it("maps failed status 6 to REPEALED", () => {
    const item = { ...completeItem, status: 6 };
    expect(mapLegiScanMasterList(response(masterlist(item)))[0].status).toBe(
      "REPEALED"
    );
  });

  it("defaults an unrecognized status to PROPOSED and populates available date", () => {
    const item = { ...completeItem, status: "0", status_date: "2023-01-11" };
    const row = mapLegiScanMasterList(response(masterlist(item)))[0];
    expect(row.status).toBe("PROPOSED");
    expect(row.introducedAt).toBe("2023-01-11");
    expect(row.passedAt).toBeNull();
  });

  it("falls back to the state option when the item omits it", () => {
    const noState = { ...completeItem, state: undefined };
    const row = mapLegiScanMasterList(response(masterlist(noState)), {
      state: "TX",
    })[0];
    expect(row.jurisdictionCode).toBe("TX");
  });

  it("skips items without a derivable state code", () => {
    const noState = { ...completeItem, state: undefined };
    expect(mapLegiScanMasterList(response(masterlist(noState)))).toEqual([]);
  });

  it("ignores the special session key and non-numeric keys", () => {
    const json = response({
      ...masterlist(completeItem),
      session: { session_id: 1541, session_tag: "20232024" },
      bogus: { not: "a bill" },
    });
    expect(mapLegiScanMasterList(json)).toHaveLength(1);
  });

  it("returns an empty array when masterlist is missing or malformed", () => {
    expect(mapLegiScanMasterList({ status: "OK" })).toEqual([]);
    expect(mapLegiScanMasterList({ masterlist: [] })).toEqual([]);
    expect(mapLegiScanMasterList(null)).toEqual([]);
  });

  it("drops malformed items and keeps good ones", () => {
    const rows = mapLegiScanMasterList(
      response(masterlist(completeItem, { number: "AB2", status: "1" }))
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).toBe("CA-AB1");
  });

  it("uses the session name when no session tag exists", () => {
    const json = response({
      ...masterlist(completeItem),
      session: { session_id: 1541, session_name: "2023 Regular" },
    });
    expect(mapLegiScanMasterList(json)[0].identifier).toBe("CA-2023 Regular-AB1");
  });
});

describe("mapLegiScanMasterListBatches", () => {
  function manyItems(count: number) {
    return masterlist(
      ...Array.from({ length: count }, (_, i) => ({
        ...completeItem,
        number: `AB${i}`,
        bill_id: 1000 + i,
      }))
    );
  }

  it("yields INGEST_CHUNK_SIZE batches and preserves the full session by default", () => {
    const json = response(manyItems(120));
    const batches = [...mapLegiScanMasterListBatches(json)];

    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(batches.flat()).toHaveLength(120);
    expect(mapLegiScanMasterList(json)).toHaveLength(120);
  });

  it("applies an explicit limit without a silent default cap", () => {
    const json = response(manyItems(120));

    expect(mapLegiScanMasterList(json, { limit: 5 })).toHaveLength(5);
    expect(
      [...mapLegiScanMasterListBatches(json, { limit: 60 })].flat()
    ).toHaveLength(60);
  });
});

describe("legiScanAdapter.fetch", () => {
  const originalKey = process.env.LEGISCAN_API_KEY;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) {
      delete process.env.LEGISCAN_API_KEY;
    } else {
      process.env.LEGISCAN_API_KEY = originalKey;
    }
  });

  it("fails closed when LEGISCAN_API_KEY is missing", async () => {
    delete process.env.LEGISCAN_API_KEY;

    await expect(legiScanAdapter.fetch({ state: "CA" })).rejects.toThrow(
      /LEGISCAN_API_KEY is not set/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires an explicit session id or state", async () => {
    process.env.LEGISCAN_API_KEY = "test-key";

    await expect(legiScanAdapter.fetch({})).rejects.toThrow(
      /requires a session id or state/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests with a timeout AbortSignal and honours an explicit limit", async () => {
    process.env.LEGISCAN_API_KEY = "test-key";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => response(masterlist(completeItem)),
    });

    const rows = await legiScanAdapter.fetch({ state: "ca", limit: 1 });

    expect(rows).toHaveLength(1);
    expect(rows[0].jurisdictionCode).toBe("CA");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("op=getMasterList");
    expect(url).toContain("state=ca");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws the LegiScan error message when the API reports an error", async () => {
    process.env.LEGISCAN_API_KEY = "test-key";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ERROR",
        alert: { message: "Invalid API key" },
      }),
    });

    await expect(legiScanAdapter.fetch({ id: 1541 })).rejects.toThrow(
      "Invalid API key"
    );
  });
});