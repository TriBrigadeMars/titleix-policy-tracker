import { describe, expect, it } from "vitest";
import { mapCongressBills } from "./congress";

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

describe("mapCongressBills", () => {
  it("maps a complete bill to the exact RawInstrument shape", () => {
    expect(mapCongressBills(response(completeBill))).toEqual([
      {
        jurisdictionCode: "US",
        type: "BILL",
        identifier: "HCONRES-10-110",
        title: "Expressing the sense of the Congress that ...",
        status: "PROPOSED",
        introducedAt: "2007-01-04",
        passedAt: null,
        effectiveAt: null,
        sourceUrl: "https://www.congress.gov/bill/110th-congress/HCONRES/10",
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
      title: "A later bill",
      status: "PROPOSED",
      introducedAt: null,
      passedAt: null,
      effectiveAt: null,
      sourceUrl: "https://www.congress.gov/bill/119th-congress/HR/1234",
      rawSummary: null,
    });
  });
});
