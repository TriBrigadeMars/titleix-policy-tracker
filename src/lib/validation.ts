import { z } from "zod";

/**
 * Cell notes are the first endpoint that accepts a request body, so this is the
 * first place input validation matters. Everything downstream of here (Prisma)
 * is parameterized, so the concerns are shape and size rather than injection:
 * reject unknown fields, cap the body, and fail with a 400 before any query.
 */

export const CELL_NOTE_MAX_LENGTH = 10_000;

const idSchema = z.string().trim().min(1).max(64);

export const cellNoteUpsertSchema = z.strictObject({
  jurisdictionId: idSchema,
  issueTagId: idSchema,
  body: z
    .string()
    .trim()
    .min(1, "Note cannot be empty")
    .max(
      CELL_NOTE_MAX_LENGTH,
      `Note cannot exceed ${CELL_NOTE_MAX_LENGTH} characters`
    ),
});

export type CellNoteUpsertInput = z.infer<typeof cellNoteUpsertSchema>;

/** Flatten zod issues into a serializable shape for the 400 response. */
export function formatIssues(
  error: z.ZodError
): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
