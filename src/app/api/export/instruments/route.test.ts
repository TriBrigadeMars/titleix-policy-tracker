import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Instrument } from "@/types";

const { getInstrumentExportRows } = vi.hoisted(() => ({
  getInstrumentExportRows: vi.fn(),
}));

vi.mock("@/lib/queries", () => ({ getInstrumentExportRows }));

import { GET } from "./route";
import { CSV_BOM } from "@/lib/instrument-export";

function makeInstrument(): Instrument {
  return {
    id: "inst-1",
    jurisdictionId: "jur-ca",
    type: "BILL",
    identifier: "AB 1327",
    title: "School athletics: Title IX equity",
    status: "PASSED",
    triageStatus: "RELEVANT",
    source: "openstates",
    sourceId: "ocd-bill/1",
    introducedAt: null,
    passedAt: null,
    effectiveAt: null,
    sourceUrl: "https://openstates.org/ca/bills/2023/AB1327/",
    rawSummary: "Equity in school sports.",
    lastCheckedAt: "2026-11-01T12:00:00.000Z",
    relevanceConfidence: 90,
    jurisdiction: {
      id: "jur-ca",
      code: "CA",
      name: "California",
      level: "STATE",
    },
    issueTags: [],
  };
}

const base = "http://localhost/api/export/instruments";

beforeEach(() => {
  vi.clearAllMocks();
  getInstrumentExportRows.mockResolvedValue({
    instruments: [makeInstrument()],
    total: 1,
  });
});

describe("GET /api/export/instruments", () => {
  it("rejects an unsupported format", async () => {
    const response = await GET(new Request(`${base}?format=pdf`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "format must be csv or json",
    });
  });

  it("defaults to CSV with download headers", async () => {
    const response = await GET(new Request(base));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="titleix-instruments-\d{4}-\d{2}-\d{2}\.csv"$/
    );
    expect(response.headers.get("X-Total-Count")).toBe("1");
    expect(response.headers.get("X-Result-Truncated")).toBe("false");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(body.startsWith(CSV_BOM)).toBe(true);
    expect(body).toContain("jurisdiction_code,jurisdiction_name,type");
    expect(body).toContain("CA,California,BILL,AB 1327");
  });

  it("returns the structured JSON payload", async () => {
    const response = await GET(new Request(`${base}?format=json`));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(".json");

    const payload = await response.json();
    expect(payload.count).toBe(1);
    expect(payload.truncated).toBe(false);
    expect(payload.instruments[0]).toMatchObject({
      id: "inst-1",
      jurisdictionCode: "CA",
      identifier: "AB 1327",
      summary: "Equity in school sports.",
    });
    expect(payload.instruments[0]).not.toHaveProperty("triageStatus");
  });

  it("reports truncation when the cap cuts the result", async () => {
    getInstrumentExportRows.mockResolvedValue({
      instruments: [makeInstrument()],
      total: 5000,
    });

    const response = await GET(new Request(`${base}?format=json`));
    const payload = await response.json();

    expect(payload.truncated).toBe(true);
    expect(payload.count).toBe(1);
    expect(response.headers.get("X-Result-Truncated")).toBe("true");
  });

  it("passes parsed filters to the query helper", async () => {
    await GET(
      new Request(
        `${base}?q=athletics&jurisdiction=ca,tx&status=passed&type=bill&sort=oldest`
      )
    );

    expect(getInstrumentExportRows).toHaveBeenCalledWith({
      q: "athletics",
      jurisdictionCodes: ["CA", "TX"],
      status: "PASSED",
      type: "BILL",
      sort: "oldest",
      page: 1,
      pageSize: 25,
    });
  });

  it("is public: no session guard is consulted", async () => {
    const response = await GET(new Request(`${base}?format=json`));
    expect(response.status).toBe(200);
  });
});
