import {
  FETCH_TIMEOUT_MS,
  type IngestAdapter,
  type RawInstrument,
} from "@/lib/ingest";
import { stateCodeFromOpenStatesJurisdiction } from "@/lib/ingest/state";

interface OpenStatesBill {
  id: string;
  identifier: string;
  title: string;
  session: string;
  jurisdiction: { id: string };
  openstates_url?: string;
  first_action_date?: string;
  latest_action_date?: string;
  latest_action_description?: string;
  latest_passage_date?: string;
}

const OPEN_STATES_BILLS_URL = "https://v3.openstates.org/bills";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOpenStatesBill(value: unknown): value is OpenStatesBill {
  if (!isRecord(value)) return false;
  const bill = value;
  const jurisdiction = bill.jurisdiction;
  return (
    typeof bill.id === "string" &&
      bill.id.startsWith("ocd-bill/") &&
      typeof bill.identifier === "string" &&
    typeof bill.session === "string" &&
    isRecord(jurisdiction) &&
    typeof jurisdiction.id === "string"
  );
}

/**
 * Map a parsed OpenStates v3 bills-list response to raw instruments. Pure: no
 * I/O, no database. Bills whose jurisdiction cannot be resolved to a US state
 * code (so they would not match a seeded jurisdiction) are skipped, as are
 * bills missing required fields. Never throws.
 */
export function mapOpenStatesBills(json: unknown): RawInstrument[] {
  if (!isRecord(json)) return [];
  const results = json.results;
  if (!Array.isArray(results)) return [];

  const rows: RawInstrument[] = [];
  for (const bill of results) {
    if (!isOpenStatesBill(bill)) continue;
    const stateCode = stateCodeFromOpenStatesJurisdiction(
      bill.jurisdiction.id
    );
    if (stateCode === null) continue;

    const title = typeof bill.title === "string" ? bill.title : "";
    rows.push({
      jurisdictionCode: stateCode,
      type: "BILL",
      // Prefix with the state code + session so identifiers stay unique even
      // when two states use the same bare bill number.
      identifier: `${stateCode}-${bill.session}-${bill.identifier}`,
      source: "openstates",
      sourceId: bill.id,
      title,
      status: typeof bill.latest_passage_date === "string" ? "PASSED" : "PROPOSED",
      introducedAt:
        typeof bill.first_action_date === "string"
          ? bill.first_action_date
          : null,
      passedAt:
        typeof bill.latest_passage_date === "string"
          ? bill.latest_passage_date
          : null,
      effectiveAt: null,
      sourceUrl:
        typeof bill.openstates_url === "string" ? bill.openstates_url : null,
      rawSummary:
        typeof bill.latest_action_description === "string"
          ? bill.latest_action_description
          : null,
    });
  }
  return rows;
}

export const openStatesAdapter: IngestAdapter = {
  name: "openstates",
  async fetch(opts) {
    // No silent default: a missing jurisdiction used to quietly ingest North
    // Carolina, which is indistinguishable from a real NC ingest.
    const jurisdiction = opts?.jurisdiction;
    if (jurisdiction === undefined || jurisdiction === "") {
      throw new Error("OpenStates ingest requires an explicit jurisdiction");
    }
    const perPage = opts?.perPage ?? opts?.limit ?? 50;

    const params = new URLSearchParams({
      jurisdiction: String(jurisdiction),
      per_page: String(perPage),
    });
    if (opts?.session !== undefined && opts.session !== "") {
      params.set("session", String(opts.session));
    }

    const url = `${OPEN_STATES_BILLS_URL}?${params.toString()}`;
    const apiKey = process.env.OPEN_STATES_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPEN_STATES_API_KEY is not set; see .env.example for instructions"
      );
    }

    const res = await fetch(url, {
      headers: { "X-API-KEY": apiKey },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`OpenStates request failed with status ${res.status}`);
    }
    return mapOpenStatesBills(await res.json());
  },
};