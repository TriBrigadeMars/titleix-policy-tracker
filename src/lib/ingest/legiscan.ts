import type { IngestAdapter, RawInstrument } from "@/lib/ingest";
import {
  legiscanIsIntroduced,
  legiscanIsPassed,
  legiscanStatusToInstrumentStatus,
} from "@/lib/ingest/state";

interface LegiScanMasterListItem {
  bill_id: number;
  number: string;
  status: number | string;
  status_date: string;
  last_action: string;
  last_action_date: string;
  title: string;
  description: string;
  url: string;
  state?: string;
}

interface LegiScanSession {
  session_id: number;
  session_name?: string;
  session_tag?: string;
}

const LEGISCAN_API_URL = "https://api.legiscan.com/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Skip the special `"session"` key LegiScan nests inside `masterlist`. */
function isMasterListItem(value: unknown): value is LegiScanMasterListItem {
  if (!isRecord(value)) return false;
  return typeof value.number === "string";
}

function legiScanState(item: LegiScanMasterListItem): string | null {
  if (typeof item.state === "string") {
    const trimmed = item.state.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  }
  return null;
}

/**
 * Map a parsed LegiScan `getMasterList` response to raw instruments. Pure: no
 * I/O, no database.
 *
 * The `masterlist` object is keyed numerically ("0", "1", …) plus a special
 * `"session"` key describing the session itself. Numeric entries are mapped;
 * anything without a numeric `bill_id` is skipped. When `state` is omitted
 * from `opts`, bills without a two-letter `state` field are skipped because
 * their jurisdiction code cannot be derived.
 */
export function mapLegiScanMasterList(
  json: unknown,
  opts?: { state?: string }
): RawInstrument[] {
  if (!isRecord(json)) return [];
  const masterlist = json.masterlist;
  if (!isRecord(masterlist)) return [];

  const fallbackState = opts?.state;
  const session = isRecord(masterlist.session)
      ? (masterlist.session as unknown as LegiScanSession)
    : null;
  const sessionTag =
    typeof session?.session_tag === "string"
      ? session.session_tag
      : typeof session?.session_name === "string"
        ? session.session_name
        : null;

  const rows: RawInstrument[] = [];
  for (const [key, value] of Object.entries(masterlist)) {
    if (key === "session") continue;
    if (!isMasterListItem(value)) continue;
    const state = legiScanState(value) ?? fallbackState;
    if (!state) continue;

    const statusValue = value.status;
    const statusDate =
      typeof value.status_date === "string" ? value.status_date : null;
    const lastActionDate =
            typeof value.last_action_date === "string" ? value.last_action_date : null;
    const availableDate = statusDate ?? lastActionDate;
    const isIntroduced = legiscanIsIntroduced(statusValue);
    const isPassed = legiscanIsPassed(statusValue);

    rows.push({
            jurisdictionCode: state,
            type: "BILL",
            // Prefix with state + session so identifiers stay unique across states
            // and sessions that reuse the same bill number.
            identifier: `${state}${sessionTag ? `-${sessionTag}` : ""}-${value.number}`,
            source: "legiscan",
            sourceId: String(value.bill_id),
            title: typeof value.title === "string" ? value.title : "",
            status: legiscanStatusToInstrumentStatus(statusValue),
            introducedAt: isIntroduced ? statusDate : availableDate,
            passedAt: isPassed ? statusDate : null,
            effectiveAt: null,
            sourceUrl: typeof value.url === "string" ? value.url : null,
            rawSummary:
              typeof value.last_action === "string"
                ? value.last_action
                : typeof value.description === "string"
                  ? value.description
                  : null,
    });
  }
  return rows;
}

/**
 * The `getMasterList` call accepts `id=<session_id>`; the state is resolved
 * from each bill's `state` field (or passed through when the API omits it).
 */
export const legiScanAdapter: IngestAdapter = {
  name: "legiscan",
  async fetch(opts) {
    const params = new URLSearchParams({ op: "getMasterList" });
    const apiKey = process.env.LEGISCAN_API_KEY;
    if (!apiKey) {
      throw new Error(
        "LEGISCAN_API_KEY is not set; see .env.example for instructions"
      );
    }
    params.set("key", apiKey);

    if (opts?.id !== undefined && opts.id !== "") {
      params.set("id", String(opts.id));
    } else if (opts?.state !== undefined && opts.state !== "") {
      params.set("state", String(opts.state));
    } else {
      throw new Error("LegiScan ingest requires a session id or state");
    }

    const url = `${LEGISCAN_API_URL}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`LegiScan request failed with status ${res.status}`);
    }

    const body = await res.json();
    if (isRecord(body) && body.status === "ERROR") {
      const message = isRecord(body.alert) && typeof body.alert.message === "string"
        ? body.alert.message
        : "LegiScan returned an error";
      throw new Error(message);
    }
    const state =
      typeof opts?.state === "string" ? opts.state.toUpperCase() : undefined;
    return mapLegiScanMasterList(body, { state });
  },
};