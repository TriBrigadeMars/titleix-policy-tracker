import { describe, expect, it } from "vitest";
import type { Instrument } from "@/types";
import {
  CSV_BOM,
  CSV_COLUMNS,
  csvEscape,
  formatInstrumentCsv,
  toExportPayload,
  toExportRecords,
} from "./instrument-export";

function makeInstrument(overrides: Partial<Instrument> = {}): Instrument {
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
    introducedAt: "2023-02-17T00:00:00.000Z",
    passedAt: "2023-09-01T00:00:00.000Z",
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
    issueTags: [
      {
        issueTag: {
          id: "tag-ath",
          slug: "athletics",
          label: "Athletics eligibility",
          sortOrder: 2,
          description: null,
        },
      },
      {
        issueTag: {
          id: "tag-cov",
          slug: "coverage",
          label: "Who is covered",
          sortOrder: 1,
          description: null,
        },
      },
    ],
    ...overrides,
  };
}

describe("csvEscape", () => {
  it("neutralises spreadsheet formula triggers from external titles", () => {
    expect(csvEscape("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvEscape("-1")).toBe("'-1");
    expect(csvEscape("H.B. 1234")).toBe("H.B. 1234");
  });

  it("leaves simple values alone", () => {
    expect(csvEscape("CA")).toBe("CA");
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("quotes commas, quotes and newlines per RFC 4180", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('He said "no"')).toBe('"He said ""no"""');
    expect(csvEscape("line one\nline two")).toBe('"line one\nline two"');
    expect(csvEscape("carriage\rreturn")).toBe('"carriage\rreturn"');
  });
});

describe("formatInstrumentCsv", () => {
  it("emits a BOM, the header, and CRLF line endings", () => {
    const csv = formatInstrumentCsv([]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(CSV_BOM.length)).toBe(`${CSV_COLUMNS.join(",")}\r\n`);
  });

  it("writes one row per instrument with ISO timestamps and joined tags", () => {
    const csv = formatInstrumentCsv([makeInstrument()]);
    const lines = csv.slice(CSV_BOM.length).split("\r\n");
    expect(lines).toHaveLength(3);

    const fields = lines[1].split(",");
    expect(fields[0]).toBe("CA");
    expect(fields[1]).toBe("California");
    expect(fields[2]).toBe("BILL");
    expect(fields[3]).toBe("AB 1327");
    expect(fields[4]).toBe("School athletics: Title IX equity");
    expect(fields[5]).toBe("PASSED");
    expect(fields[6]).toBe("2023-02-17T00:00:00.000Z");
    expect(fields[8]).toBe("");
    expect(fields[9]).toBe("2026-11-01T12:00:00.000Z");
    expect(fields[10]).toBe("openstates");
    expect(fields[13]).toBe("Athletics eligibility; Who is covered");
  });

  it("quotes a title containing a comma without shifting columns", () => {
    const csv = formatInstrumentCsv([
      makeInstrument({ title: "Athletics, harassment, and reporting" }),
    ]);
    expect(csv).toContain('"Athletics, harassment, and reporting"');
  });
});

describe("toExportRecords", () => {
  it("maps the public record shape and exposes tag slugs and labels", () => {
    const [record] = toExportRecords([makeInstrument()]);
    expect(record).toEqual({
      id: "inst-1",
      jurisdictionCode: "CA",
      jurisdictionName: "California",
      type: "BILL",
      identifier: "AB 1327",
      title: "School athletics: Title IX equity",
      status: "PASSED",
      introducedAt: "2023-02-17T00:00:00.000Z",
      passedAt: "2023-09-01T00:00:00.000Z",
      effectiveAt: null,
      lastCheckedAt: "2026-11-01T12:00:00.000Z",
      source: "openstates",
      sourceId: "ocd-bill/1",
      sourceUrl: "https://openstates.org/ca/bills/2023/AB1327/",
      summary: "Equity in school sports.",
      issueTags: [
        { slug: "athletics", label: "Athletics eligibility" },
        { slug: "coverage", label: "Who is covered" },
      ],
    });
  });

  it("does not leak triage status or internal notes", () => {
    const [record] = toExportRecords([makeInstrument()]);
    expect(record).not.toHaveProperty("triageStatus");
    expect(record).not.toHaveProperty("notes");
  });
});

describe("toExportPayload", () => {
  it("carries count, truncation and generation time", () => {
    const payload = toExportPayload(
      [makeInstrument()],
      "2026-11-25T12:00:00.000Z",
      true
    );
    expect(payload.generatedAt).toBe("2026-11-25T12:00:00.000Z");
    expect(payload.count).toBe(1);
    expect(payload.truncated).toBe(true);
    expect(payload.instruments).toHaveLength(1);
  });
});
