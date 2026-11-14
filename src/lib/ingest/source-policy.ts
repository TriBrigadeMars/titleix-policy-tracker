import { prisma } from "@/lib/db";
import { JURISDICTIONS_CATALOG } from "@/lib/seed-catalog";
import { stateCodeFromOpenStatesJurisdiction } from "./state";

/** OpenStates accepts names and OCD IDs as well as postal abbreviations. */
export function sourceStateCode(value: string): string {
  const input = value.trim().toLowerCase();
  return stateCodeFromOpenStatesJurisdiction(input)
    ?? JURISDICTIONS_CATALOG.find((j) => j.code.toLowerCase() === input || j.name.toLowerCase() === input)?.code
    ?? input.toUpperCase();
}

export type StateSource = "legiscan" | "openstates";
/** Owner decision recorded in docs/hardening/README.md, 2026-11-12. */
export const LEGISCAN_ONLY_STATES = ["CO", "KS", "NM", "OK", "UT", "WY"] as const;

export class SourceOverlapError extends Error {
  constructor(readonly states: string[]) {
    super(`SourceOverlap: ${states.join(", ")} already belongs to the other state source. Use ?force=1 only for an intentional admin override.`);
    this.name = "SourceOverlapError";
  }
}

/** Check persisted source ownership as well as the six LegiScan-only states. */
export async function findSourceConflicts(source: StateSource, codes: string[]): Promise<string[]> {
  const states = [...new Set(codes.map(sourceStateCode))];
  if (!states.length) return [];
  const other = source === "legiscan" ? "openstates" : "legiscan";
  const existing = await prisma.instrument.findMany({
    where: { type: "BILL", source: other, jurisdiction: { code: { in: states } } },
    distinct: ["jurisdictionId"],
    select: { jurisdiction: { select: { code: true } } },
  });
  return [...new Set([
    ...existing.map((row) => row.jurisdiction.code),
    ...(source === "openstates" ? states.filter((code) => LEGISCAN_ONLY_STATES.some((state) => state === code)) : []),
  ])].sort();
}
