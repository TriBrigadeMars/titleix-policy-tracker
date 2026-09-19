import type { Prisma, TriageStatus as PrismaTriageStatus } from "@prisma/client";

/**
 * Title IX relevance determination represented as a single authoritative
 * status on `Instrument`:
 *
 *   - UNREVIEWED
 *   - RELEVANT
 *   - NOT_RELEVANT
 *
 * `relevanceConfidence` is optional metadata, not the status discriminator.
 */
export type TriageStatus = "UNREVIEWED" | "RELEVANT" | "NOT_RELEVANT";

export function triageStatus(
  status: PrismaTriageStatus | string
): TriageStatus {
  if (typeof status === "string") {
    const upper = status.toUpperCase();
    if (upper === "RELEVANT") return "RELEVANT";
    if (upper === "NOT_RELEVANT") return "NOT_RELEVANT";
    if (upper === "UNREVIEWED") return "UNREVIEWED";
  }
  return "UNREVIEWED";
}

/**
 * The Prisma `where` predicate that selects a triage status.
 * Uses `triageStatus` as the single source of truth.
 */
export function triageWhere(
  status: string
): Prisma.InstrumentWhereInput {
  const normalized = status.toUpperCase();
  switch (normalized) {
    case "RELEVANT":
      return { triageStatus: "RELEVANT" };
    case "NOT_RELEVANT":
      return { triageStatus: "NOT_RELEVANT" };
    case "UNREVIEWED":
      return { triageStatus: "UNREVIEWED" };
    default:
      return {};
  }
}