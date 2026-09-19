import { describe, expect, it } from "vitest";
import {
  cellNoteComparisonWhere,
  instrumentComparisonWhere,
  instrumentTriageWhere,
  userListWhere,
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
      triageStatus: "RELEVANT",
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
      triageStatus: "RELEVANT",
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
      triageStatus: "UNREVIEWED",
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
      triageStatus: "RELEVANT",
    });
  });

  it("builds where filter for not_relevant items", () => {
    expect(
      instrumentTriageWhere({
        relevance: "not_relevant",
      })
    ).toEqual({
      triageStatus: "NOT_RELEVANT",
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

describe("userListWhere", () => {
  it("returns empty where when no filter provided", () => {
    expect(userListWhere({})).toEqual({});
  });

  it("filters by role when provided", () => {
    expect(userListWhere({ role: "ADMIN" })).toEqual({
      role: "ADMIN",
    });
  });

  it("filters by search term in name and email", () => {
    expect(userListWhere({ search: "alice" })).toEqual({
      OR: [
        { name: { contains: "alice", mode: "insensitive" } },
        { email: { contains: "alice", mode: "insensitive" } },
      ],
    });
  });

  it("combines role and search filters", () => {
    expect(userListWhere({ search: "bob", role: "EDITOR" })).toEqual({
      role: "EDITOR",
      OR: [
        { name: { contains: "bob", mode: "insensitive" } },
        { email: { contains: "bob", mode: "insensitive" } },
      ],
    });
  });
});

