import { describe, expect, it } from "vitest";
import {
  billFilterParams,
  billOrderBy,
  billPageHref,
  billWhere,
  hasBillFilters,
  MAX_BILL_JURISDICTION_FILTERS,
  MAX_BILL_PAGE,
  MAX_BILL_PAGE_SIZE,
  MAX_BILL_QUERY_LENGTH,
  parseBillQuery,
} from "./bill-query";

function parse(query: string) {
  return parseBillQuery(new URLSearchParams(query));
}

describe("parseBillQuery", () => {
  it("defaults to an unfiltered first page sorted newest first", () => {
    expect(parse("")).toEqual({
      q: "",
      jurisdictionCodes: [],
      status: null,
      type: null,
      sort: "newest",
      page: 1,
      pageSize: 25,
    });
  });

  it("reads every supported filter", () => {
    const query = parse(
      "q=athletics&jurisdiction=tx,ca&status=passed&type=bill&sort=oldest&page=3&limit=50"
    );
    expect(query).toEqual({
      q: "athletics",
      jurisdictionCodes: ["TX", "CA"],
      status: "PASSED",
      type: "BILL",
      sort: "oldest",
      page: 3,
      pageSize: 50,
    });
  });

  it("drops unknown enum values instead of failing the page", () => {
    const query = parse("status=IMAGINARY&type=LAW&sort=random");
    expect(query.status).toBeNull();
    expect(query.type).toBeNull();
    expect(query.sort).toBe("newest");
  });

  it("normalizes, dedupes and caps jurisdiction codes", () => {
    expect(parse("jurisdiction=ca, CA ,tx,,").jurisdictionCodes).toEqual([
      "CA",
      "TX",
    ]);

    const many = Array.from({ length: 60 }, (_, i) =>
      String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26))
    ).join(",");
    expect(parse(`jurisdiction=${many}`).jurisdictionCodes.length).toBe(
      MAX_BILL_JURISDICTION_FILTERS
    );
  });

  it("ignores malformed jurisdiction codes", () => {
    expect(parse("jurisdiction=California,1A,C").jurisdictionCodes).toEqual([]);
  });

  it("clamps page and page size into bounds", () => {
    expect(parse("page=0").page).toBe(1);
    expect(parse("page=abc").page).toBe(1);
    expect(parse(`page=${MAX_BILL_PAGE + 10}`).page).toBe(MAX_BILL_PAGE);
    expect(parse(`limit=${MAX_BILL_PAGE_SIZE + 10}`).pageSize).toBe(
      MAX_BILL_PAGE_SIZE
    );
    expect(parse("limit=-5").pageSize).toBe(25);
  });

  it("truncates an over-long search string", () => {
    const query = parse(`q=${"a".repeat(MAX_BILL_QUERY_LENGTH + 50)}`);
    expect(query.q).toHaveLength(MAX_BILL_QUERY_LENGTH);
  });
});

describe("billWhere", () => {
  it("always requires RELEVANT, even with no filters", () => {
    expect(
      billWhere({
        q: "",
        jurisdictionCodes: [],
        status: null,
        type: null,
      })
    ).toEqual({ triageStatus: "RELEVANT" });
  });

  it("searches title, identifier and summary with one insensitive OR", () => {
    const where = billWhere({
      q: "athletics",
      jurisdictionCodes: [],
      status: null,
      type: null,
    });

    expect(where.triageStatus).toBe("RELEVANT");
    expect(where.OR).toEqual([
      { title: { contains: "athletics", mode: "insensitive" } },
      { identifier: { contains: "athletics", mode: "insensitive" } },
      { rawSummary: { contains: "athletics", mode: "insensitive" } },
    ]);
  });

  it("combines jurisdiction, status and type filters", () => {
    const where = billWhere({
      q: "",
      jurisdictionCodes: ["CA", "TX"],
      status: "PASSED",
      type: "BILL",
    });

    expect(where).toEqual({
      triageStatus: "RELEVANT",
      jurisdiction: { code: { in: ["CA", "TX"] } },
      status: "PASSED",
      type: "BILL",
    });
    expect(where).not.toHaveProperty("OR");
  });
});

describe("billOrderBy", () => {
  it("sorts undated rows last on the date orders", () => {
    expect(billOrderBy("newest")[0]).toEqual({
      introducedAt: { sort: "desc", nulls: "last" },
    });
    expect(billOrderBy("oldest")[0]).toEqual({
      introducedAt: { sort: "asc", nulls: "last" },
    });
  });

  it("sorts by status and by jurisdiction code", () => {
    expect(billOrderBy("status")[0]).toEqual({ status: "asc" });
    expect(billOrderBy("state")[0]).toEqual({
      jurisdiction: { code: "asc" },
    });
  });
});

describe("hasBillFilters", () => {
  it("is false only when every filter is empty", () => {
    expect(
      hasBillFilters({
        q: "",
        jurisdictionCodes: [],
        status: null,
        type: null,
      })
    ).toBe(false);
    expect(
      hasBillFilters({
        q: "x",
        jurisdictionCodes: [],
        status: null,
        type: null,
      })
    ).toBe(true);
    expect(
      hasBillFilters({
        q: "",
        jurisdictionCodes: ["CA"],
        status: null,
        type: null,
      })
    ).toBe(true);
  });
});

describe("billPageHref", () => {
  const base = {
    q: "athletics",
    jurisdictionCodes: ["CA", "TX"],
    status: "PASSED" as const,
    type: "BILL" as const,
    sort: "newest" as const,
    page: 1,
    pageSize: 25,
  };

  it("omits defaults", () => {
    expect(billPageHref({ ...base, q: "", jurisdictionCodes: [], status: null, type: null }, 1)).toBe(
      "/bills"
    );
  });

  it("keeps filters and adds the page", () => {
    const href = billPageHref(base, 4);
    expect(href.startsWith("/bills?")).toBe(true);
    expect(href).toContain("q=athletics");
    expect(href).toContain("jurisdiction=CA%2CTX");
    expect(href).toContain("status=PASSED");
    expect(href).toContain("type=BILL");
    expect(href).toContain("page=4");
  });

  it("keeps a non-default sort and page size", () => {
    const href = billPageHref({ ...base, sort: "state", pageSize: 50 }, 1);
    expect(href).toContain("sort=state");
    expect(href).toContain("limit=50");
  });
});

describe("billFilterParams", () => {
  it("carries only the narrowing filters", () => {
    const params = billFilterParams({
      q: "harassment",
      jurisdictionCodes: ["US"],
      status: null,
      type: "REGULATION",
    });
    expect(params.get("q")).toBe("harassment");
    expect(params.get("jurisdiction")).toBe("US");
    expect(params.get("type")).toBe("REGULATION");
    expect(params.has("status")).toBe(false);
    expect(params.has("page")).toBe(false);
  });
});
