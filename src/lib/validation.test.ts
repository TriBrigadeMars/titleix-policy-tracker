import { describe, expect, it } from "vitest";
import {
  CELL_NOTE_MAX_LENGTH,
  cellNoteUpsertSchema,
  formatIssues,
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
