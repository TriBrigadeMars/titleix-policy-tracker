import { z } from "zod";

import { ALL_ROLES } from "./roles";

/**
 * Cell notes are the first endpoint that accepts a request body, so this is the
 * first place input validation matters. Everything downstream of here (Prisma)
 * is parameterized, so the concerns are shape and size rather than injection:
 * reject unknown fields, cap the body, and fail with a 400 before any query.
 */

export const CELL_NOTE_MAX_LENGTH = 10_000;
export const INSTRUMENT_NOTE_MAX_LENGTH = 10_000;

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

export const instrumentTriageSchema = z.strictObject({
  triageStatus: z.enum(["UNREVIEWED", "RELEVANT", "NOT_RELEVANT"]),
  relevanceConfidence: z
    .number()
    .int()
    .min(0, "Confidence must be between 0 and 100")
    .max(100, "Confidence must be between 0 and 100")
    .nullable()
    .optional(),
  issueTagIds: z
    .array(idSchema)
    .max(32, "At most 32 issue tags may be attached"),
});

export type InstrumentTriageInput = z.infer<typeof instrumentTriageSchema>;

export const instrumentNoteCreateSchema = z.strictObject({
  instrumentId: idSchema,
  body: z
    .string()
    .trim()
    .min(1, "Note cannot be empty")
    .max(
      INSTRUMENT_NOTE_MAX_LENGTH,
      `Note cannot exceed ${INSTRUMENT_NOTE_MAX_LENGTH} characters`
    ),
});

export type InstrumentNoteCreateInput = z.infer<typeof instrumentNoteCreateSchema>;

export const userRoleUpdateSchema = z.strictObject({
  role: z.enum(ALL_ROLES),
});

export type UserRoleUpdateInput = z.infer<typeof userRoleUpdateSchema>;

/** Flatten zod issues into a serializable shape for the 400 response. */
export function formatIssues(
  error: z.ZodError
): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
