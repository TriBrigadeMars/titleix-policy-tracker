import { z } from "zod";
import {
  FETCH_TIMEOUT_MS,
  INGEST_CHUNK_SIZE,
  type IngestAdapter,
  type RawInstrument,
} from "@/lib/ingest";
import {
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

interface LegiScanSession {
  session_id: number;
  session_name?: string;
  session_tag?: string;
}

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

function legiScanState(item: LegiScanMasterListItem): string | null {
  if (typeof item.state === "string") {
    const trimmed = item.state.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  }
  return null;
}

function toRawInstrument(
  value: LegiScanMasterListItem,
  state: string,
  sessionTag: string | null
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
    identifier: `${state}${sessionTag ? `-${sessionTag}` : ""}-${value.number}`,
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

  const fallbackState = opts?.state;
  const limit = opts?.limit;
  const session = isRecord(masterlist.session)
    ? (masterlist.session as unknown as LegiScanSession)
    : null;
  const sessionTag =
    typeof session?.session_tag === "string"
      ? session.session_tag
      : typeof session?.session_name === "string"
        ? session.session_name
        : null;

  let batch: RawInstrument[] = [];
  let mapped = 0;
  for (const [key, value] of Object.entries(masterlist)) {
    if (key === "session") continue;
    const item = parseMasterListItem(value);
    if (!item) continue;
    const state = legiScanState(item) ?? fallbackState;
    if (!state) continue;

    batch.push(toRawInstrument(item, state, sessionTag));
    mapped += 1;
    if (batch.length >= INGEST_CHUNK_SIZE) {
      yield batch;
      batch = [];
    }
    if (limit !== undefined && limit > 0 && mapped >= limit) break;
  }
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
 * bills without a two-letter `state` field are skipped because their
 * jurisdiction code cannot be derived.
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
 * from each bill's `state` field (or passed through when the API omits it).
 *
 * By default the whole session is ingested: `getMasterList` is a full session
 * dump and silently truncating it would drop bills. `opts.limit` is an explicit
 * opt-in cap for admin testing, and is applied while mapping so the adapter
 * never materializes the full mapped array.
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
    const state =
      typeof opts?.state === "string" ? opts.state.toUpperCase() : undefined;
    const limit = Number(opts?.limit);
    return mapLegiScanMasterList(body, {
      state,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });
  },
};