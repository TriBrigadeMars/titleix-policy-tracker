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
const VETOED_CODES = new Set([5]); // Vetoed
const FAILED_CODES = new Set([6]); // Failed

/**
 * Map a LegiScan BillStatus (numeric, or numeric string) to an instrument
 * status. Conservative: anything that is not clearly passed-chamber or enacted
 * falls back to `PROPOSED`.
 *
 * Unsuccessful measures keep their own identity: a vetoed bill maps to
 * `VETOED` and a failed bill to `FAILED`. Neither is `REPEALED` — a repealed
 * law was enacted and later removed, which is a different lifecycle.
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
  if (VETOED_CODES.has(code)) return "VETOED";
  if (FAILED_CODES.has(code)) return "FAILED";
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
/** LegiScan API client 1.4.1, schema-pgsql.sql: ls_state (not FIPS codes).
 * Source: https://api.legiscan.com/dl/legiscan-1.4.1.tar.gz
 */
export const LEGISCAN_STATE_IDS: Readonly<Record<number, string>> = {
  1: "AL",
  2: "AK",
  3: "AZ",
  4: "AR",
  5: "CA",
  6: "CO",
  7: "CT",
  8: "DE",
  9: "FL",
  10: "GA",
  11: "HI",
  12: "ID",
  13: "IL",
  14: "IN",
  15: "IA",
  16: "KS",
  17: "KY",
  18: "LA",
  19: "ME",
  20: "MD",
  21: "MA",
  22: "MI",
  23: "MN",
  24: "MS",
  25: "MO",
  26: "MT",
  27: "NE",
  28: "NV",
  29: "NH",
  30: "NJ",
  31: "NM",
  32: "NY",
  33: "NC",
  34: "ND",
  35: "OH",
  36: "OK",
  37: "OR",
  38: "PA",
  39: "RI",
  40: "SC",
  41: "SD",
  42: "TN",
  43: "TX",
  44: "UT",
  45: "VT",
  46: "VA",
  47: "WA",
  48: "WV",
  49: "WI",
  50: "WY",
  51: "DC",
};
