import { describe, expect, it } from "vitest";
import {
  billIdentifier,
  billSourceUrl,
  inferBillStatus,
  mapBillToRawInstrument,
  type CongressBill,
} from "./congress-gov";

function bill(overrides: Partial<CongressBill> = {}): CongressBill {
  return {
    congress: 119,
    type: "HR",
    number: 1234,
    title: "Title IX Protection Act",
    originChamber: "House",
    updateDate: "2025-01-15T10:30:00Z",
    latestAction: {
      actionDate: "2025-01-15",
      text: "Introduced in House",
    },
    url: "https://api.congress.gov/v3/bill/119/hr/1234?format=json",
    ...overrides,
  };
}

describe("inferBillStatus", () => {
  it("returns PROPOSED for an introduced bill", () => {
    expect(inferBillStatus("Introduced in House")).toBe("PROPOSED");
  });

  it("returns PASSED for 'Became Public Law'", () => {
    expect(inferBillStatus("Became Public Law No: 117-108.")).toBe("PASSED");
  });

  it("returns PASSED for 'Signed by the President'", () => {
    expect(inferBillStatus("Signed by the President.")).toBe("PASSED");
  });

  it("returns PASSED for 'Signed by President' (no 'the')", () => {
    expect(inferBillStatus("Signed by President.")).toBe("PASSED");
  });

  it("returns ENJOINED for a veto", () => {
    expect(inferBillStatus("Vetoed by the President.")).toBe("ENJOINED");
  });

  it("returns REPEALED", () => {
    expect(inferBillStatus("Repealed by Public Law 118-1.")).toBe("REPEALED");
  });

  it("returns PROPOSED for undefined", () => {
    expect(inferBillStatus(undefined)).toBe("PROPOSED");
  });
});

describe("billIdentifier", () => {
  it("builds a congress-type-number identifier", () => {
    expect(
      billIdentifier({ congress: 119, type: "HR", number: 1234 })
    ).toBe("119-HR-1234");
  });

  it("uppercases the type", () => {
    expect(
      billIdentifier({ congress: 117, type: "hr", number: 21 })
    ).toBe("117-HR-21");
  });
});

describe("billSourceUrl", () => {
  it("builds the congress.gov URL", () => {
    expect(
      billSourceUrl({ congress: 119, type: "HR", number: 1234 })
    ).toBe("https://www.congress.gov/bill/119th-congress/hr/1234");
  });

  it("lowercases the type for the URL", () => {
    expect(
      billSourceUrl({ congress: 117, type: "S", number: 3099 })
    ).toBe("https://www.congress.gov/bill/117th-congress/s/3099");
  });
});

describe("mapBillToRawInstrument", () => {
  it("maps a proposed bill", () => {
    const raw = mapBillToRawInstrument(bill());
    expect(raw).toEqual({
      jurisdictionCode: "US",
      type: "BILL",
      identifier: "119-HR-1234",
      title: "Title IX Protection Act",
      status: "PROPOSED",
      introducedAt: null,
      passedAt: null,
      effectiveAt: null,
      sourceUrl: "https://www.congress.gov/bill/119th-congress/hr/1234",
      rawSummary: null,
    });
  });

  it("maps a passed bill with passedAt from latestAction", () => {
    const raw = mapBillToRawInstrument(
      bill({
        latestAction: {
          actionDate: "2022-04-06",
          text: "Became Public Law No: 117-108.",
        },
      })
    );
    expect(raw.status).toBe("PASSED");
    expect(raw.passedAt).toBe(new Date("2022-04-06").toISOString());
  });

  it("does not set passedAt for a proposed bill", () => {
    const raw = mapBillToRawInstrument(bill());
    expect(raw.passedAt).toBeNull();
  });

  it("always uses US as the jurisdiction code", () => {
    const raw = mapBillToRawInstrument(bill());
    expect(raw.jurisdictionCode).toBe("US");
  });

  it("supports all bill types", () => {
    const types = ["HR", "S", "HJRES", "SJRES", "HCONRES", "SCONRES", "HRES", "SRES"];
    for (const type of types) {
      const raw = mapBillToRawInstrument(bill({ type }));
      expect(raw.type).toBe("BILL");
      expect(raw.identifier).toContain(type.toUpperCase());
    }
  });

  it("throws on an unknown bill type", () => {
    expect(() => mapBillToRawInstrument(bill({ type: "UNKNOWN" }))).toThrow(
      "Unknown bill type: UNKNOWN"
    );
  });

  it("handles a bill with no latest action", () => {
    const raw = mapBillToRawInstrument(bill({ latestAction: undefined }));
    expect(raw.status).toBe("PROPOSED");
    expect(raw.passedAt).toBeNull();
  });

  it("handles a Senate bill", () => {
    const raw = mapBillToRawInstrument(
      bill({ type: "S", number: 3099, originChamber: "Senate" })
    );
    expect(raw.identifier).toBe("119-S-3099");
    expect(raw.sourceUrl).toBe(
      "https://www.congress.gov/bill/119th-congress/s/3099"
    );
  });
});
