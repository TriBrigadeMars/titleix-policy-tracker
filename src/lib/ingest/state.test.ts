import { describe, expect, it } from "vitest";
import {
  legiscanIsIntroduced,
  legiscanIsPassed,
  legiscanStatusToInstrumentStatus,
  stateCodeFromOpenStatesJurisdiction,
} from "./state";

describe("stateCodeFromOpenStatesJurisdiction", () => {
  it("extracts uppercase state codes from OCD jurisdiction ids", () => {
    expect(
      stateCodeFromOpenStatesJurisdiction(
        "ocd-jurisdiction/country:us/state:nc/government"
      )
    ).toBe("NC");
    expect(
      stateCodeFromOpenStatesJurisdiction(
        "ocd-jurisdiction/country:us/state:tx/government"
      )
    ).toBe("TX");
  });

  it("returns DC for the district jurisdiction", () => {
    expect(
      stateCodeFromOpenStatesJurisdiction(
        "ocd-jurisdiction/country:us/district:dc/government"
      )
    ).toBe("DC");
  });

  it("returns null for non-strings and unrecognized ids", () => {
    expect(stateCodeFromOpenStatesJurisdiction(undefined)).toBeNull();
    expect(stateCodeFromOpenStatesJurisdiction(42)).toBeNull();
    expect(stateCodeFromOpenStatesJurisdiction("ocd-jurisdiction/country:ca")).toBeNull();
  });
});

describe("legiscanStatusToInstrumentStatus", () => {
  it("maps introduced/engrossed to PROPOSED", () => {
    expect(legiscanStatusToInstrumentStatus(1)).toBe("PROPOSED");
    expect(legiscanStatusToInstrumentStatus("2")).toBe("PROPOSED");
  });

  it("maps enrolled/passed to PASSED", () => {
    expect(legiscanStatusToInstrumentStatus(3)).toBe("PASSED");
    expect(legiscanStatusToInstrumentStatus(4)).toBe("PASSED");
  });

  it("maps override/chaptered to EFFECTIVE", () => {
    expect(legiscanStatusToInstrumentStatus(7)).toBe("EFFECTIVE");
    expect(legiscanStatusToInstrumentStatus(8)).toBe("EFFECTIVE");
  });

  it("maps vetoed/failed to REPEALED", () => {
    expect(legiscanStatusToInstrumentStatus(5)).toBe("REPEALED");
    expect(legiscanStatusToInstrumentStatus(6)).toBe("REPEALED");
  });

  it("falls back to PROPOSED for everything else, including non-numeric", () => {
    expect(legiscanStatusToInstrumentStatus(0)).toBe("PROPOSED");
    expect(legiscanStatusToInstrumentStatus(12)).toBe("PROPOSED");
    expect(legiscanStatusToInstrumentStatus("bogus")).toBe("PROPOSED");
    expect(legiscanStatusToInstrumentStatus(null)).toBe("PROPOSED");
  });
});

describe("legiscanIsIntroduced", () => {
  it("is true only for status 1", () => {
    expect(legiscanIsIntroduced(1)).toBe(true);
    expect(legiscanIsIntroduced("1")).toBe(true);
    expect(legiscanIsIntroduced(4)).toBe(false);
  });
});

describe("legiscanIsPassed", () => {
  it("is true for passed-chamber and enacted codes", () => {
    for (const code of [3, 4, 7, 8]) {
      expect(legiscanIsPassed(code), String(code)).toBe(true);
    }
    expect(legiscanIsPassed(1)).toBe(false);
    expect(legiscanIsPassed("bogus")).toBe(false);
  });
});