import type { InstrumentStatus, InstrumentType } from "@/types";

/**
 * Display metadata for the two instrument enums. The Prisma enums stay the
 * source of truth for values; these lists exist so query parsing and UI labels
 * cannot drift from each other.
 */
export const INSTRUMENT_STATUSES = [
  "PROPOSED",
  "PASSED",
  "EFFECTIVE",
  "ENJOINED",
  "FAILED",
  "VETOED",
  "REPEALED",
] as const satisfies readonly InstrumentStatus[];

export const INSTRUMENT_TYPES = [
  "BILL",
  "STATUTE",
  "REGULATION",
] as const satisfies readonly InstrumentType[];

const STATUS_LABELS: Record<InstrumentStatus, string> = {
  PROPOSED: "Proposed",
  PASSED: "Passed",
  EFFECTIVE: "Effective",
  ENJOINED: "Enjoined",
  FAILED: "Failed",
  VETOED: "Vetoed",
  REPEALED: "Repealed",
};

const TYPE_LABELS: Record<InstrumentType, string> = {
  BILL: "Bill",
  STATUTE: "Statute",
  REGULATION: "Regulation",
};

/** Human label for a status; unknown values pass through unchanged. */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status as InstrumentStatus] ?? status;
}

/** Human label for a type; unknown values pass through unchanged. */
export function typeLabel(type: string): string {
  return TYPE_LABELS[type as InstrumentType] ?? type;
}

export function isInstrumentStatus(value: string): value is InstrumentStatus {
  return (INSTRUMENT_STATUSES as readonly string[]).includes(value);
}

export function isInstrumentType(value: string): value is InstrumentType {
  return (INSTRUMENT_TYPES as readonly string[]).includes(value);
}
