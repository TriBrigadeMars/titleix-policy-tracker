import { describe, expect, it } from "vitest";
import { mapLegiScanMasterList } from "./legiscan";

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

  it("maps numeric status 4 to PASSED with the status date as passedAt", () => {
    const item = { ...completeItem, status: 4, status_date: "2023-08-01" };
    const row = mapLegiScanMasterList(response(masterlist(item)))[0];
    expect(row.status).toBe("PASSED");
    expect(row.passedAt).toBe("2023-08-01");
    expect(row.introducedAt).toBeNull();
  });

  it("maps chaptered status 8 to EFFECTIVE", () => {
    const item = { ...completeItem, status: 8 };
    expect(mapLegiScanMasterList(response(masterlist(item)))[0].status).toBe(
      "EFFECTIVE"
    );
  });

  it("defaults an unrecognized status to PROPOSED without dates", () => {
    const item = { ...completeItem, status: "0", status_date: "2023-01-11" };
    const row = mapLegiScanMasterList(response(masterlist(item)))[0];
    expect(row.status).toBe("PROPOSED");
    expect(row.introducedAt).toBeNull();
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