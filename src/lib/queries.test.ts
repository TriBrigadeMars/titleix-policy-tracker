import { describe, expect, it } from "vitest";
import {
  cellNoteComparisonWhere,
  instrumentComparisonWhere,
  instrumentTriageWhere,
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

describe("instrumentTriageWhere", () => {
  it("builds where filter for unreviewed items", () => {
    expect(
      instrumentTriageWhere({
        relevance: "unreviewed",
      })
    ).toEqual({
      isTitleIXRelevant: false,
      relevanceConfidence: null,
    });
  });

  it("builds where filter for relevant items", () => {
    expect(
      instrumentTriageWhere({
        jurisdictionId: "jur_1",
        status: "PROPOSED",
        relevance: "relevant",
      })
    ).toEqual({
      jurisdictionId: "jur_1",
      status: "PROPOSED",
      isTitleIXRelevant: true,
    });
  });

  it("builds where filter for not_relevant items", () => {
    expect(
      instrumentTriageWhere({
        relevance: "not_relevant",
      })
    ).toEqual({
      isTitleIXRelevant: false,
      relevanceConfidence: { not: null },
    });
  });

  it("builds where filter for all items", () => {
    expect(
      instrumentTriageWhere({
        jurisdictionId: "jur_2",
        relevance: "all",
      })
    ).toEqual({
      jurisdictionId: "jur_2",
    });
  });
});
