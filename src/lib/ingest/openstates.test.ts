import { describe, expect, it } from "vitest";
import { mapOpenStatesBills } from "./openstates";

const completeBill = {
  id: "ocd-bill/00000000-1111-2222-3333-444455556666",
  identifier: "SB 113",
  title: "An act to protect students",
  session: "2023",
  jurisdiction: {
    id: "ocd-jurisdiction/country:us/state:nc/government",
    name: "North Carolina",
  },
  openstates_url: "https://openstates.org/nc/bills/2023/SB113/",
  first_action_date: "2023-02-01",
  latest_action_date: "2023-05-10",
  latest_action_description: "Referred to Committee on Education",
  latest_passage_date: "2023-06-15",
};

function response(...bills: unknown[]) {
  return { results: bills, pagination: { per_page: 50, page: 1 } };
}

describe("mapOpenStatesBills", () => {
  it("maps a complete bill to the exact RawInstrument shape", () => {
    expect(mapOpenStatesBills(response(completeBill))).toEqual([
      {
        jurisdictionCode: "NC",
        type: "BILL",
        identifier: "NC-2023-SB 113",
        title: "An act to protect students",
        status: "PASSED",
        introducedAt: "2023-02-01",
        passedAt: "2023-06-15",
        effectiveAt: null,
        sourceUrl: "https://openstates.org/nc/bills/2023/SB113/",
        rawSummary: "Referred to Committee on Education",
      },
    ]);
  });

  it("derives state codes (uppercase) from OCD jurisdiction ids", () => {
    const bill = {
      ...completeBill,
      jurisdiction: {
        id: "ocd-jurisdiction/country:us/state:tx/government",
        name: "Texas",
      },
    };
    expect(mapOpenStatesBills(response(bill))[0].jurisdictionCode).toBe("TX");
  });

  it("defaults a bill without a passage date to PROPOSED", () => {
    const bill = { ...completeBill, latest_passage_date: undefined };
    const rows = mapOpenStatesBills(response(bill));
    expect(rows[0].status).toBe("PROPOSED");
    expect(rows[0].passedAt).toBeNull();
  });

  it("maps absent optional fields to null", () => {
    const bill = {
      id: completeBill.id,
      identifier: "SB 113",
      title: "Minimal",
      session: "2023",
      jurisdiction: completeBill.jurisdiction,
    };
    const row = mapOpenStatesBills(response(bill))[0];
    expect(row.introducedAt).toBeNull();
    expect(row.passedAt).toBeNull();
    expect(row.sourceUrl).toBeNull();
    expect(row.rawSummary).toBeNull();
  });

  it("returns an empty array when results is missing or not an array", () => {
    expect(mapOpenStatesBills({})).toEqual([]);
    expect(mapOpenStatesBills({ results: "nope" })).toEqual([]);
    expect(mapOpenStatesBills(null)).toEqual([]);
  });

  it("drops bills with missing required fields", () => {
    const noId = { ...completeBill, id: undefined };
        const noIdentifier = { ...completeBill, identifier: undefined };
        const noSession = { ...completeBill, session: undefined };
        const noJurisdiction = { ...completeBill, jurisdiction: undefined };
    expect(mapOpenStatesBills(response(noId))).toEqual([]);
    expect(mapOpenStatesBills(response(noIdentifier))).toEqual([]);
    expect(mapOpenStatesBills(response(noSession))).toEqual([]);
    expect(mapOpenStatesBills(response(noJurisdiction))).toEqual([]);
  });

  it("skips bills whose jurisdiction has no derivable US state code", () => {
    const bill = {
      ...completeBill,
      jurisdiction: { id: "ocd-jurisdiction/country:ca", name: "Canada" },
    };
    expect(mapOpenStatesBills(response(bill))).toEqual([]);
  });

  it("keeps good bills when mixed with malformed or foreign ones", () => {
    const rows = mapOpenStatesBills(
      response(
        completeBill,
        { id: "x", identifier: "SB 1", session: "2023", jurisdiction: completeBill.jurisdiction },
        { ...completeBill, jurisdiction: { id: "ocd-jurisdiction/country:ca" } }
      )
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).toBe("NC-2023-SB 113");
  });
});