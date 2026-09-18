import { describe, expect, it } from "vitest";
import {
  CELL_NOTE_MAX_LENGTH,
  INSTRUMENT_NOTE_MAX_LENGTH,
  cellNoteUpsertSchema,
  formatIssues,
  instrumentNoteCreateSchema,
  instrumentTriageSchema,
} from "./validation";

const valid = {
  jurisdictionId: "jur_1",
  issueTagId: "tag_1",
  body: "Covers sexual orientation and gender identity.",
};

describe("cellNoteUpsertSchema", () => {
  it("accepts a well-formed payload", () => {
    const result = cellNoteUpsertSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("trims the body and the ids", () => {
    const result = cellNoteUpsertSchema.parse({
      jurisdictionId: "  jur_1  ",
      issueTagId: " tag_1 ",
      body: "  spaced  ",
    });
    expect(result).toEqual({
      jurisdictionId: "jur_1",
      issueTagId: "tag_1",
      body: "spaced",
    });
  });

  it("rejects an empty or whitespace-only body", () => {
    for (const body of ["", "   ", "\n\t"]) {
      expect(cellNoteUpsertSchema.safeParse({ ...valid, body }).success).toBe(
        false
      );
    }
  });

  it("rejects an empty id", () => {
    expect(
      cellNoteUpsertSchema.safeParse({ ...valid, jurisdictionId: "" }).success
    ).toBe(false);
    expect(
      cellNoteUpsertSchema.safeParse({ ...valid, issueTagId: "  " }).success
    ).toBe(false);
  });

  it("enforces the length cap at the boundary", () => {
    const atLimit = { ...valid, body: "x".repeat(CELL_NOTE_MAX_LENGTH) };
    const overLimit = { ...valid, body: "x".repeat(CELL_NOTE_MAX_LENGTH + 1) };

    expect(cellNoteUpsertSchema.safeParse(atLimit).success).toBe(true);
    expect(cellNoteUpsertSchema.safeParse(overLimit).success).toBe(false);
  });

  it("rejects unknown fields so a body cannot carry extra columns", () => {
    const result = cellNoteUpsertSchema.safeParse({
      ...valid,
      authorId: "attacker-controlled",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(cellNoteUpsertSchema.safeParse({ body: "hi" }).success).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(
      cellNoteUpsertSchema.safeParse({ ...valid, body: 123 }).success
    ).toBe(false);
    expect(
      cellNoteUpsertSchema.safeParse({ ...valid, jurisdictionId: null }).success
    ).toBe(false);
  });

  it("rejects a non-object payload", () => {
    for (const payload of [null, undefined, "string", 42, []]) {
      expect(cellNoteUpsertSchema.safeParse(payload).success).toBe(false);
    }
  });
});

describe("instrumentTriageSchema", () => {
  it("accepts valid triage payload", () => {
    const result = instrumentTriageSchema.safeParse({
      isTitleIXRelevant: true,
      relevanceConfidence: 95,
      issueTagIds: ["tag_1", "tag_2"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts null or omitted relevanceConfidence", () => {
    expect(
      instrumentTriageSchema.safeParse({
        isTitleIXRelevant: false,
        relevanceConfidence: null,
        issueTagIds: [],
      }).success
    ).toBe(true);

    expect(
      instrumentTriageSchema.safeParse({
        isTitleIXRelevant: false,
        issueTagIds: [],
      }).success
    ).toBe(true);
  });

  it("rejects confidence out of 0-100 bounds", () => {
    expect(
      instrumentTriageSchema.safeParse({
        isTitleIXRelevant: true,
        relevanceConfidence: -1,
        issueTagIds: [],
      }).success
    ).toBe(false);

    expect(
      instrumentTriageSchema.safeParse({
        isTitleIXRelevant: true,
        relevanceConfidence: 101,
        issueTagIds: [],
      }).success
    ).toBe(false);
  });

  it("rejects extra fields", () => {
    expect(
      instrumentTriageSchema.safeParse({
        isTitleIXRelevant: true,
        issueTagIds: [],
        maliciousField: "sneaky",
      }).success
    ).toBe(false);
  });

  it("caps issue tags array at 32", () => {
    const thirtyTwo = Array.from({ length: 32 }, (_, i) => `tag_${i}`);
    expect(
      instrumentTriageSchema.safeParse({
        isTitleIXRelevant: true,
        issueTagIds: thirtyTwo,
      }).success
    ).toBe(true);

    const thirtyThree = Array.from({ length: 33 }, (_, i) => `tag_${i}`);
    expect(
      instrumentTriageSchema.safeParse({
        isTitleIXRelevant: true,
        issueTagIds: thirtyThree,
      }).success
    ).toBe(false);
  });
});

describe("instrumentNoteCreateSchema", () => {
  it("accepts valid note create payload", () => {
    const result = instrumentNoteCreateSchema.safeParse({
      instrumentId: "inst_123",
      body: "This bill touches Title IX athletics provisions.",
    });
    expect(result.success).toBe(true);
  });

  it("trims whitespace and rejects empty body", () => {
    expect(
      instrumentNoteCreateSchema.safeParse({
        instrumentId: "inst_123",
        body: "   ",
      }).success
    ).toBe(false);
  });

  it("enforces length limit", () => {
    expect(
      instrumentNoteCreateSchema.safeParse({
        instrumentId: "inst_123",
        body: "a".repeat(INSTRUMENT_NOTE_MAX_LENGTH + 1),
      }).success
    ).toBe(false);
  });

  it("rejects authorId or other unknown fields in body", () => {
    expect(
      instrumentNoteCreateSchema.safeParse({
        instrumentId: "inst_123",
        body: "Valid note",
        authorId: "attacker_id",
      }).success
    ).toBe(false);
  });
});

describe("formatIssues", () => {
  it("flattens issues into path/message pairs", () => {
    const result = cellNoteUpsertSchema.safeParse({ ...valid, body: "" });
    expect(result.success).toBe(false);
    if (result.success) return;

    const issues = formatIssues(result.error);
    expect(issues).toEqual([
      { path: "body", message: "Note cannot be empty" },
    ]);
  });
});
