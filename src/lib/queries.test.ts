import { describe, expect, it } from "vitest";
import {
  cellNoteComparisonWhere,
  instrumentComparisonWhere,
} from "./queries";

describe("instrumentComparisonWhere", () => {
  it("always scopes to the named jurisdictions and Title IX-relevant rows", () => {
    expect(
      instrumentComparisonWhere({
        jurisdictionIds: ["j1", "j2"],
        issueTagIds: [],
      })
    ).toEqual({
      jurisdictionId: { in: ["j1", "j2"] },
      isTitleIXRelevant: true,
    });
  });

  it("adds an issue-tag filter when provided", () => {
    expect(
      instrumentComparisonWhere({
        jurisdictionIds: ["j1"],
        issueTagIds: ["t1"],
      })
    ).toEqual({
      jurisdictionId: { in: ["j1"] },
      isTitleIXRelevant: true,
      issueTags: { some: { issueTagId: { in: ["t1"] } } },
    });
  });
});

describe("cellNoteComparisonWhere", () => {
  it("requires jurisdiction ids", () => {
    expect(
      cellNoteComparisonWhere({
        jurisdictionIds: ["j1"],
        issueTagIds: [],
      })
    ).toEqual({
      jurisdictionId: { in: ["j1"] },
    });
  });

  it("adds an issue-tag filter when provided", () => {
    expect(
      cellNoteComparisonWhere({
        jurisdictionIds: ["j1"],
        issueTagIds: ["t1"],
      })
    ).toEqual({
      jurisdictionId: { in: ["j1"] },
      issueTagId: { in: ["t1"] },
    });
  });
});
