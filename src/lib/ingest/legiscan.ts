import { z } from "zod";
import {
  FETCH_TIMEOUT_MS,
  INGEST_CHUNK_SIZE,
  type IngestAdapter,
  type RawInstrument,
} from "@/lib/ingest";
import {
  LEGISCAN_STATE_IDS,
  legiscanIsIntroduced,
  legiscanIsPassed,
  legiscanStatusToInstrumentStatus,
} from "@/lib/ingest/state";

export interface LegiScanMapOptions {
  /** Fallback jurisdiction code for bills whose `state` field is absent. */
  state?: string;
  /**
   * Optional cap on how many rows are mapped. Omitted (or non-positive) means
   * map the entire session, which is the production default: `getMasterList`
   * is a full session dump and dropping bills silently would lose coverage.
   */
  limit?: number;
}

/**
 * Boundary schema for a `getMasterList` entry. Only the fields that establish
 * identity (`bill_id`, `number`) or lifecycle state (`status`) are required;
 * descriptive fields stay optional so a sparse upstream row is still usable.
 *
 * `bill_id` is the source identity, so it must be a real positive integer —
 * without this check `String(value.bill_id)` can produce the literal
 * `"undefined"` and collide on the `(source, sourceId)` unique constraint.
 */
const LegiScanMasterListItemSchema = z.object({
  bill_id: z.number().int().positive(),
  number: z.string().min(1),
  status: z.union([z.number(), z.string()]),
  status_date: z.string().optional(),
  last_action: z.string().optional(),
  last_action_date: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
  state: z.string().optional(),
});

/** Derived from the schema so the two can never drift apart. */
type LegiScanMasterListItem = z.infer<typeof LegiScanMasterListItemSchema>;

const LEGISCAN_API_URL = "https://api.legiscan.com/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Parse one `masterlist` entry, skipping the special `"session"` key LegiScan
 * nests inside `masterlist` and any row that fails boundary validation.
 */
function parseMasterListItem(value: unknown): LegiScanMasterListItem | null {
  const parsed = LegiScanMasterListItemSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function stateCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return Object.values(LEGISCAN_STATE_IDS).includes(code) ? code : null;
}

/** Session metadata is authoritative; URLs are display links, not identity. */
export function getLegiScanSession(json: unknown): { state: string | null; id: number | null } {
  const session = isRecord(json) && isRecord(json.masterlist) && isRecord(json.masterlist.session)
    ? json.masterlist.session : null;
  return {
    state: typeof session?.state_id === "number" ? LEGISCAN_STATE_IDS[session.state_id] ?? null : null,
    id: typeof session?.session_id === "number" && Number.isSafeInteger(session.session_id) && session.session_id > 0
      ? session.session_id : null,
  };
}

function toRawInstrument(
  value: LegiScanMasterListItem,
  state: string,
  sessionId: number
): RawInstrument {
  const statusValue = value.status;
  const statusDate = value.status_date ?? null;
  const isIntroduced = legiscanIsIntroduced(statusValue);
  const isPassed = legiscanIsPassed(statusValue);

  return {
    jurisdictionCode: state,
    type: "BILL",
    // Prefix with state + session so identifiers stay unique across states
    // and sessions that reuse the same bill number.
    identifier: `${state}-s${sessionId}-${value.number}`,
    source: "legiscan",
    sourceId: String(value.bill_id),
    title: value.title ?? "",
    status: legiscanStatusToInstrumentStatus(statusValue),
    // Only a genuine introduction status carries an introduction date. Falling
    // back to a later action date would present a passage date as the date the
    // bill was introduced.
    introducedAt: isIntroduced ? statusDate : null,
    passedAt: isPassed ? statusDate : null,
    effectiveAt: null,
    sourceUrl: value.url ?? null,
    rawSummary: value.last_action ?? value.description ?? null,
  };
}

/**
 * Map a parsed LegiScan `getMasterList` response to raw instruments, yielding
 * {@link INGEST_CHUNK_SIZE}-sized batches instead of one array.
 *
 * `getMasterList` is a full session dump — a large state can return tens of
 * thousands of bills — so callers that only need to hand rows to
 * {@link upsertInstruments} can stream batch by batch rather than materializing
 * a second full copy of the mapped rows alongside the parsed JSON body. Use
 * {@link mapLegiScanMasterList} when a plain array is more convenient.
 */
export function* mapLegiScanMasterListBatches(
  json: unknown,
  opts?: LegiScanMapOptions
): Generator<RawInstrument[]> {
  if (!isRecord(json)) return;
  const masterlist = json.masterlist;
  if (!isRecord(masterlist)) return;

  const session = getLegiScanSession(json);
  const fallbackState = stateCode(opts?.state);
  if (session.state && fallbackState && session.state !== fallbackState) {
    throw new Error("UnmappableResponse: LegiScan session does not match requested state");
  }
  const entries = Object.entries(masterlist).filter(([key]) => key !== "session");
  if (!entries.length) return;
  if (!session.id) throw new Error("UnmappableResponse: LegiScan session id is missing");
  const limit = opts?.limit;

  let batch: RawInstrument[] = [];
  let mapped = 0;
  for (const [, value] of entries) {
    const item = parseMasterListItem(value);
    if (!item) continue;
    const state = session.state ?? stateCode(item.state) ?? fallbackState;
    if (!state) continue;

    batch.push(toRawInstrument(item, state, session.id));
    mapped += 1;
    if (batch.length >= INGEST_CHUNK_SIZE) {
      yield batch;
      batch = [];
    }
    if (limit !== undefined && limit > 0 && mapped >= limit) break;
  }
  if (mapped === 0) throw new Error("UnmappableResponse: no LegiScan bills could be mapped");
  if (batch.length > 0) yield batch;
}

/**
 * Map a parsed LegiScan `getMasterList` response to raw instruments. Pure: no
 * I/O, no database.
 *
 * The `masterlist` object is keyed numerically ("0", "1", …) plus a special
 * `"session"` key describing the session itself. Numeric entries are validated
 * against {@link LegiScanMasterListItemSchema} and mapped; anything without a
 * positive integer `bill_id` is skipped. When `state` is omitted from `opts`,
 * the session state_id is used, with explicit state or bill state as a fallback.
 * Nonempty unmappable responses throw instead of recording a false success.
 */
export function mapLegiScanMasterList(
  json: unknown,
  opts?: LegiScanMapOptions
): RawInstrument[] {
  const rows: RawInstrument[] = [];
  for (const batch of mapLegiScanMasterListBatches(json, opts)) {
    rows.push(...batch);
  }
  return rows;
}

/**
 * The `getMasterList` call accepts `id=<session_id>`; the state is resolved
 * from the session's numeric `state_id`, using the published LegiScan table.
 *
 * By default the whole session is ingested: `getMasterList` is a full session
 * dump and silently truncating it would drop bills. `opts.limit` is an explicit
 * opt-in cap for admin testing, and is applied while mapping so the adapter
 * never materializes the full mapped array.
 */
export async function fetchLegiScanMasterList(opts?: Parameters<IngestAdapter["fetch"]>[0]): Promise<unknown> {
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
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
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
  return body;
}

export const legiScanAdapter: IngestAdapter = {
  name: "legiscan",
  async fetch(opts) {
    const body = await fetchLegiScanMasterList(opts);
    const state = typeof opts?.state === "string" ? opts.state : undefined;
    const limit = Number(opts?.limit);
    return mapLegiScanMasterList(body, {
      state,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });
  },
};
