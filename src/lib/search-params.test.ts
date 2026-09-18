import { describe, expect, it } from "vitest";
import {
  MAX_COMPARISON_JURISDICTIONS,
  parseComparisonQuery,
  parseIdList,
  parseTriageQuery,
} from "./search-params";

describe("parseIdList", () => {
  it("returns an empty list for a missing param", () => {
    expect(parseIdList(null)).toEqual([]);
  });

  it("returns an empty list for an empty param", () => {
    expect(parseIdList("")).toEqual([]);
  });

  it("splits on commas", () => {
    expect(parseIdList("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims surrounding whitespace", () => {
    expect(parseIdList("  a , b  ")).toEqual(["a", "b"]);
  });

  it("drops empty entries", () => {
    expect(parseIdList("a,,b")).toEqual(["a", "b"]);
    expect(parseIdList(",")).toEqual([]);
    expect(parseIdList("a,")).toEqual(["a"]);
  });

  it("preserves a single value", () => {
    expect(parseIdList("only")).toEqual(["only"]);
  });

  it("deduplicates while preserving first-seen order", () => {
    expect(parseIdList("CA,US,CA,TX")).toEqual(["CA", "US", "TX"]);
  });

  it("drops entries longer than 64 characters", () => {
    const tooLong = "x".repeat(65);
    expect(parseIdList(`ok,${tooLong}`)).toEqual(["ok"]);
  });
});

describe("parseComparisonQuery", () => {
  it("requires jurisdictionIds", () => {
    expect(parseComparisonQuery(new URLSearchParams())).toEqual({
      ok: false,
      error: "Missing jurisdictionIds",
    });
  });

  it("rejects more jurisdictions than the comparison cap", () => {
    const ids = Array.from(
      { length: MAX_COMPARISON_JURISDICTIONS + 1 },
      (_, i) => `j${i}`
    ).join(",");
    expect(
      parseComparisonQuery(new URLSearchParams({ jurisdictionIds: ids }))
    ).toEqual({
      ok: false,
      error: `At most ${MAX_COMPARISON_JURISDICTIONS} jurisdictionIds`,
    });
  });

  it("accepts a bounded jurisdiction list", () => {
    expect(
      parseComparisonQuery(
        new URLSearchParams({ jurisdictionIds: "a,b", issueTagIds: "t1" })
      )
    ).toEqual({
      ok: true,
      jurisdictionIds: ["a", "b"],
      issueTagIds: ["t1"],
    });
  });
});

describe("parseTriageQuery", () => {
  it("uses sensible defaults when no params are provided", () => {
    expect(parseTriageQuery(new URLSearchParams())).toEqual({
      jurisdictionCode: undefined,
      status: undefined,
      relevance: "unreviewed",
      limit: 50,
    });
  });

  it("parses valid filters", () => {
    expect(
      parseTriageQuery(
        new URLSearchParams({
          jurisdiction: "CA",
          status: "PASSED",
          relevance: "relevant",
          limit: "25",
        })
      )
    ).toEqual({
      jurisdictionCode: "CA",
      status: "PASSED",
      relevance: "relevant",
      limit: 25,
    });
  });

  it("clamps limit between 1 and MAX_TRIAGE_LIMIT", () => {
    expect(
      parseTriageQuery(new URLSearchParams({ limit: "200" })).limit
    ).toBe(100);

    expect(
      parseTriageQuery(new URLSearchParams({ limit: "-5" })).limit
    ).toBe(50);
  });

  it("ignores invalid status or relevance values and falls back safely", () => {
    expect(
      parseTriageQuery(
        new URLSearchParams({
          status: "INVALID_STATUS",
          relevance: "something_else",
        })
      )
    ).toEqual({
      jurisdictionCode: undefined,
      status: undefined,
      relevance: "unreviewed",
      limit: 50,
    });
  });
});
