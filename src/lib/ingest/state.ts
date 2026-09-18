import type { InstrumentStatus } from "@/types";

/**
 * Shared, pure helpers for state-level ingest adapters: deriving a US state
 * code from an OpenStates jurisdiction id and mapping LegiScan's numeric
 * `BillStatus` to the domain `InstrumentStatus`. No I/O, no database access.
 */

/**
 * Extract the two-letter state code from an OpenStates v3 jurisdiction id.
 * Jurisdiction ids use the OCD format, e.g.
 * `ocd-jurisdiction/country:us/state:nc/government`. Returns the uppercase
 * code, or null when the id is not a string or carries no recognizable state.
 */
export function stateCodeFromOpenStatesJurisdiction(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const state = /\/state:([a-z]{2})\//.exec(id);
  if (state) return state[1].toUpperCase();
  const district = /\/district:dc\//.exec(id);
  if (district) return "DC";
  return null;
}

/**
 * LegiScan's `status` field is a number in `getBill` detail but a string in
 * `getMasterList`. Normalize either to the numeric BillStatus code, or null
 * when the value cannot be interpreted.
 */
function legiscanStatusCode(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const PASSED_CODES = new Set([3, 4]); // Enrolled, Passed
const EFFECTIVE_CODES = new Set([7, 8]); // Override, Chaptered

/**
 * Map a LegiScan BillStatus (numeric, or numeric string) to an instrument
 * status. Conservative: anything that is not clearly passed-chamber or enacted
 * falls back to `PROPOSED`.
 *
 * LegiScan BillStatus enum: 0=NA, 1=Introduced, 2=Engrossed, 3=Enrolled,
 * 4=Passed, 5=Vetoed, 6=Failed, 7=Override, 8=Chaptered, 9=Refer,
 * 10=ReportPass, 11=ReportDNP, 12=Draft.
 */
export function legiscanStatusToInstrumentStatus(
  value: unknown
): InstrumentStatus {
  const code = legiscanStatusCode(value);
  if (code === null) return "PROPOSED";
  if (PASSED_CODES.has(code)) return "PASSED";
  if (EFFECTIVE_CODES.has(code)) return "EFFECTIVE";
  return "PROPOSED";
}

/** True when the LegiScan status represents the bill's introduction. */
export function legiscanIsIntroduced(value: unknown): boolean {
  return legiscanStatusCode(value) === 1;
}

/** True when the LegiScan status means the bill passed a chamber or was enacted. */
export function legiscanIsPassed(value: unknown): boolean {
  const code = legiscanStatusCode(value);
  return code !== null && (code === 3 || code === 4 || code === 7 || code === 8);
}