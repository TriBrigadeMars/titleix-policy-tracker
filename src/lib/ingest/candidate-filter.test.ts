import { describe, expect, it } from "vitest";
import type { RawInstrument } from "@/lib/ingest";
import {
  matchesTitleIxTerms,
  selectCandidates,
  TITLE_IX_TERMS,
} from "./candidate-filter";

function row(title: string, rawSummary: string | null = null): RawInstrument {
  return {
    jurisdictionCode: "US",
    type: "BILL",
    identifier: "HR-1-119",
    title,
    status: "PROPOSED",
    introducedAt: null,
    passedAt: null,
    effectiveAt: null,
    sourceUrl: null,
    rawSummary,
  };
}

describe("matchesTitleIxTerms", () => {
  it.each([
    ["Protects students under Title IX", null],
    ["Title 9 athletics rule", null],
    ["A highway bill", "Amends Title IX grievance procedures"],
    ["Sex discrimination in education programs", null],
    ["Sexual harassment standard", null],
    ["Gender identity on sports teams", null],
    ["Women and Girls in Sports Act", null],
    ["Athletics eligibility for school teams", null],
    ["School locker rooms and restrooms", null],
    ["Office for Civil Rights guidance", null],
    ["Dear Colleague letter on athletics", null],
    ["Pregnancy discrimination against a pregnant student", null],
  ] satisfies [string, string | null][])(
    "keeps %s",
    (title, summary) => {
      expect(matchesTitleIxTerms(title, summary)).toBe(true);
    }
  );

  it.each([
    ["Highway funding authorization", "Resurfaces I-5"],
    ["Budget act of 2025", null],
    ["Naming a post office", null],
    ["Water rights compact", "Irrigation districts"],
    ["", null],
    ["Education funding formula", "K-12 average daily attendance"],
  ] satisfies [string, string | null][])(
    "drops %s",
    (title, summary) => {
      expect(matchesTitleIxTerms(title, summary)).toBe(false);
    }
  );

  it("treats punctuation as spaces so Title-IX still matches", () => {
    expect(matchesTitleIxTerms("Title-IX coordinator duties")).toBe(true);
  });

  it("exposes a maintained term list", () => {
    expect(TITLE_IX_TERMS).toContain("title ix");
    expect(TITLE_IX_TERMS.length).toBeGreaterThan(10);
  });
});

describe("selectCandidates", () => {
  it("records the drop count and keeps matching rows", () => {
    const { kept, dropped } = selectCandidates([
      row("Title IX athletics bill"),
      row("Highway funding"),
      row("Tax credit", "No education content"),
    ]);
    expect(dropped).toBe(2);
    expect(kept).toHaveLength(1);
    expect(kept[0].title).toMatch(/Title IX/);
  });
});
