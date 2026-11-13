/**
 * One-shot capture of a real LegiScan `getMasterList` response for hardening
 * task 05 Part A (see `scripts/capture-legiscan-masterlist.ts`).
 *
 * This module is deliberately standalone: it does not import the ingest
 * pipeline or the database, and it never changes how ingest maps rows. It only
 * fetches, reports what the response actually contains, and writes a trimmed
 * fixture.
 *
 * Secret handling:
 * - The API key is read from `LEGISCAN_API_KEY` in the environment only. It is
 *   refused on argv and never read from a file.
 * - The request URL carries the key, so it is never logged or put in an error
 *   message. Every printed line is passed through {@link redactSecret}.
 * - The fixture is checked with {@link assertNoSecret} before it is written; if
 *   the key (or any `key=` query fragment) is present, nothing is written.
 */
import { parseArgs } from "node:util";

export const LEGISCAN_API_URL = "https://api.legiscan.com/";
export const DEFAULT_FIXTURE_PATH =
  "src/lib/ingest/__fixtures__/legiscan-masterlist.json";
export const FIXTURE_ROW_COUNT = 3;
const REQUEST_TIMEOUT_MS = 30_000;

/** Fetches a URL and returns the parsed JSON body. Injected for tests. */
export type FetchJson = (url: URL) => Promise<unknown>;

export interface CaptureDeps {
  env: Record<string, string | undefined>;
  argv: string[];
  fetchJson?: FetchJson;
  writeFile?: (path: string, contents: string) => Promise<void>;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

export interface CaptureArgs {
  state?: string;
  sessionId?: number;
  out: string;
}

export interface SessionSummary {
  session_id: number;
  year_start?: unknown;
  year_end?: unknown;
  special?: unknown;
  session_tag?: unknown;
  session_title?: unknown;
  session_name?: unknown;
}

export interface MasterListFindings {
  /** Number of bill rows (every masterlist entry except `session`). */
  rowCount: number;
  /** The masterlist key of the row the per-row findings describe. */
  sampleRowKey: string | null;
  /** Keys present on that one bill row, in response order. */
  sampleRowKeys: string[];
  /** Every key seen on any bill row, sorted. */
  allRowKeys: string[];
  /** The full `masterlist.session` object, or null when absent. */
  session: Record<string, unknown> | null;
  /** Row fields whose name mentions "state", with the sample row's value. */
  rowStateFields: { field: string; value: unknown }[];
  /** Row fields whose value is exactly two upper-case letters. */
  rowTwoLetterValues: { field: string; value: string }[];
  /** State code parsed from the row `url` (legiscan.com/XX/bill/...), if any. */
  rowUrlState: string | null;
  /** `session.state_id` when it is a number. */
  sessionStateId: number | null;
  /** Session fields whose name mentions "state", with their values. */
  sessionStateFields: { field: string; value: unknown }[];
  /** `session.session_tag` as returned. */
  sessionTag: unknown;
  /** True when `session_tag` looks like a year ("2023" or "20232024"). */
  sessionTagLooksLikeYear: boolean;
}

export class CaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Replace every occurrence of the key, and any `key=...` fragment, in text. */
export function redactSecret(text: string, apiKey: string | undefined): string {
  let out = text;
  if (apiKey) out = out.split(apiKey).join("[REDACTED]");
  return out.replace(/key=[^&\s"']*/gi, "[REDACTED]");
}

/** Throw (without echoing the secret) if text contains the key or `key=`. */
export function assertNoSecret(text: string, apiKey: string): void {
  if (apiKey && text.includes(apiKey)) {
    throw new CaptureError(
      "Refusing to write: output contains the LegiScan API key"
    );
  }
  if (/key=/i.test(text)) {
    throw new CaptureError(
      'Refusing to write: output contains a "key=" query fragment'
    );
  }
}

const USAGE =
  "Usage: LEGISCAN_API_KEY must be set in the environment, then\n" +
  "  npm run ingest:legiscan-capture -- --state XX\n" +
  "  npm run ingest:legiscan-capture -- --session <session_id>\n" +
  `Optional: --out <path> (default ${DEFAULT_FIXTURE_PATH})`;

export function parseCaptureArgs(
  argv: string[],
  apiKey: string | undefined
): CaptureArgs {
  // Refuse anything that looks like a key on argv: it would end up in shell
  // history. Do not echo the offending argument back.
  const looksLikeKey = (arg: string) =>
    /^-{1,2}(api[-_]?)?key\b/i.test(arg) ||
    /key=/i.test(arg) ||
    (apiKey !== undefined && apiKey !== "" && arg.includes(apiKey));
  if (argv.some(looksLikeKey)) {
    throw new CaptureError(
      "Do not pass the API key on the command line; set LEGISCAN_API_KEY in the environment instead"
    );
  }

  let values: { state?: string; session?: string; out?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        state: { type: "string" },
        session: { type: "string" },
        out: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CaptureError(`${redactSecret(message, apiKey)}\n${USAGE}`);
  }

  if ((values.state === undefined) === (values.session === undefined)) {
    throw new CaptureError(`Pass exactly one of --state or --session\n${USAGE}`);
  }

  const args: CaptureArgs = { out: values.out ?? DEFAULT_FIXTURE_PATH };
  if (values.state !== undefined) {
    const state = values.state.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) {
      throw new CaptureError("--state must be a two-letter code such as DE");
    }
    args.state = state;
  } else {
    const sessionId = Number(values.session);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      throw new CaptureError("--session must be a positive integer session_id");
    }
    args.sessionId = sessionId;
  }
  return args;
}

export const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    // Status only: the response object's url carries the key.
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * Call one LegiScan operation. Any failure is rethrown with a message that
 * names the operation and has the key redacted, so a fetch error that quotes
 * the URL cannot leak it.
 */
export async function callLegiScan(
  op: string,
  params: Record<string, string>,
  apiKey: string,
  fetchJson: FetchJson
): Promise<Record<string, unknown>> {
  const url = new URL(LEGISCAN_API_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("op", op);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  let body: unknown;
  try {
    body = await fetchJson(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CaptureError(
      `LegiScan ${op} request failed: ${redactSecret(message, apiKey)}`
    );
  }

  if (!isRecord(body)) {
    throw new CaptureError(`LegiScan ${op} returned a non-object body`);
  }
  if (body.status !== "OK") {
    const alert =
      isRecord(body.alert) && typeof body.alert.message === "string"
        ? body.alert.message
        : `status ${JSON.stringify(body.status)}`;
    throw new CaptureError(
      `LegiScan ${op} returned an error: ${redactSecret(alert, apiKey)}`
    );
  }
  return body;
}

function sessionSortKey(s: Record<string, unknown>): [number, number, number] {
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  return [num(s.year_end), num(s.year_start), num(s.session_id)];
}

/**
 * Pick a session from a `getSessionList` body: the most recent regular
 * (non-special) session, falling back to the most recent of any kind. Regular
 * sessions are what the scheduled ingest reads, so they are the useful sample.
 */
export function pickSession(body: Record<string, unknown>): {
  chosen: SessionSummary;
  all: SessionSummary[];
} {
  const raw = Array.isArray(body.sessions) ? body.sessions : [];
  const all = raw
    .filter(isRecord)
    .filter(
      (s) => typeof s.session_id === "number" && Number.isInteger(s.session_id)
    )
    .sort((a, b) => {
      const ka = sessionSortKey(a);
      const kb = sessionSortKey(b);
      for (let i = 0; i < ka.length; i += 1) {
        if (ka[i] !== kb[i]) return kb[i] - ka[i];
      }
      return 0;
    }) as unknown as SessionSummary[];

  if (all.length === 0) {
    throw new CaptureError("getSessionList returned no sessions with a session_id");
  }
  const regular = all.find((s) => Number(s.special) === 0);
  return { chosen: regular ?? all[0], all };
}

function masterListOf(body: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(body.masterlist)) {
    throw new CaptureError("getMasterList response has no masterlist object");
  }
  return body.masterlist;
}

function billRows(masterlist: Record<string, unknown>): [string, Record<string, unknown>][] {
  return Object.entries(masterlist).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      entry[0] !== "session" && isRecord(entry[1])
  );
}

/** Extract the Part A findings from a `getMasterList` body. Pure. */
export function extractFindings(body: Record<string, unknown>): MasterListFindings {
  const masterlist = masterListOf(body);
  const session = isRecord(masterlist.session) ? masterlist.session : null;
  const rows = billRows(masterlist);
  const sample = rows[0];
  const sampleRow = sample?.[1] ?? {};

  const allKeys = new Set<string>();
  for (const [, row] of rows) for (const key of Object.keys(row)) allKeys.add(key);

  const urlMatch =
    typeof sampleRow.url === "string"
      ? /legiscan\.com\/([A-Za-z]{2})\//.exec(sampleRow.url)
      : null;

  const sessionTag = session?.session_tag;

  return {
    rowCount: rows.length,
    sampleRowKey: sample?.[0] ?? null,
    sampleRowKeys: Object.keys(sampleRow),
    allRowKeys: [...allKeys].sort(),
    session,
    rowStateFields: Object.entries(sampleRow)
      .filter(([field]) => /state/i.test(field))
      .map(([field, value]) => ({ field, value })),
    rowTwoLetterValues: Object.entries(sampleRow)
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && /^[A-Z]{2}$/.test(entry[1])
      )
      .map(([field, value]) => ({ field, value })),
    rowUrlState: urlMatch ? urlMatch[1].toUpperCase() : null,
    sessionStateId:
      session && typeof session.state_id === "number" ? session.state_id : null,
    sessionStateFields: session
      ? Object.entries(session)
          .filter(([field]) => /state/i.test(field))
          .map(([field, value]) => ({ field, value }))
      : [],
    sessionTag,
    sessionTagLooksLikeYear:
      typeof sessionTag === "string" && /^\d{4}(\d{4})?$/.test(sessionTag.trim()),
  };
}

/**
 * Trim a `getMasterList` body to `{ status, masterlist: { session, <first 3
 * rows> } }`, keeping the upstream keys and values unchanged. No field is
 * added.
 */
export function trimMasterList(
  body: Record<string, unknown>,
  rowCount = FIXTURE_ROW_COUNT
): Record<string, unknown> {
  const masterlist = masterListOf(body);
  const trimmed: Record<string, unknown> = {};
  if ("session" in masterlist) trimmed.session = masterlist.session;
  for (const [key, row] of billRows(masterlist).slice(0, rowCount)) {
    trimmed[key] = row;
  }
  return { status: body.status, masterlist: trimmed };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Render findings as Markdown suitable for pasting into the PR. */
export function formatFindings(
  findings: MasterListFindings,
  sessionId: number
): string {
  const yesNo = (b: boolean) => (b ? "yes" : "no");
  const rowState =
    findings.rowStateFields.length > 0
      ? findings.rowStateFields.map((f) => `\`${f.field}\`=${json(f.value)}`).join(", ")
      : "none";
  const twoLetter =
    findings.rowTwoLetterValues.length > 0
      ? findings.rowTwoLetterValues.map((f) => `\`${f.field}\`=${json(f.value)}`).join(", ")
      : "none";
  const sessionState =
    findings.sessionStateFields.length > 0
      ? findings.sessionStateFields.map((f) => `\`${f.field}\`=${json(f.value)}`).join(", ")
      : "none";

  return [
    `## LegiScan getMasterList findings (session_id ${sessionId})`,
    "",
    `Bill rows in response: ${findings.rowCount}`,
    "",
    `### Keys on one bill row (masterlist["${findings.sampleRowKey ?? "-"}"])`,
    "",
    findings.sampleRowKeys.map((k) => `- \`${k}\``).join("\n") || "- (no rows)",
    "",
    `All keys seen on any row: ${findings.allRowKeys.map((k) => `\`${k}\``).join(", ") || "(none)"}`,
    "",
    "### Full `session` object",
    "",
    "```json",
    findings.session ? json(findings.session) : "null (no masterlist.session key)",
    "```",
    "",
    "### Two-letter state",
    "",
    `- Row fields named like "state": ${rowState}`,
    `- Row fields whose value is two upper-case letters: ${twoLetter}`,
    `- State parsed from row \`url\`: ${findings.rowUrlState ?? "none"}`,
    `- \`session.state_id\`: ${findings.sessionStateId ?? "absent"}`,
    `- Session fields named like "state": ${sessionState}`,
    "",
    "### session_tag",
    "",
    `- \`session_tag\`: ${findings.sessionTag === undefined ? "absent" : json(findings.sessionTag)}`,
    `- Looks like a year: ${yesNo(findings.sessionTagLooksLikeYear)}`,
  ].join("\n");
}

/**
 * Run the capture. Throws {@link CaptureError} on any problem; the caller
 * prints the message and exits non-zero.
 */
export async function runCapture(deps: CaptureDeps): Promise<MasterListFindings> {
  const apiKey = deps.env.LEGISCAN_API_KEY?.trim();
  if (!apiKey) {
    throw new CaptureError(
      "LEGISCAN_API_KEY is not set. Export it in this shell (do not put it on the command line or in a file) and re-run."
    );
  }

  const args = parseCaptureArgs(deps.argv, apiKey);
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const log = (line: string) => (deps.log ?? console.log)(redactSecret(line, apiKey));
  const writeFile =
    deps.writeFile ??
    (async (path: string, contents: string) => {
      const fs = await import("node:fs/promises");
      const nodePath = await import("node:path");
      await fs.mkdir(nodePath.dirname(path), { recursive: true });
      await fs.writeFile(path, contents, "utf8");
    });

  let sessionId: number;
  if (args.sessionId !== undefined) {
    sessionId = args.sessionId;
    log(`Using session_id ${sessionId} from --session.`);
  } else {
    const list = await callLegiScan(
      "getSessionList",
      { state: args.state as string },
      apiKey,
      fetchJson
    );
    const { chosen, all } = pickSession(list);
    log(`getSessionList ${args.state}: ${all.length} session(s)`);
    for (const s of all) {
      log(
        `  ${s.session_id === chosen.session_id ? "*" : " "} ${s.session_id}  ${String(s.year_start)}-${String(s.year_end)}  special=${String(s.special)}  tag=${json(s.session_tag)}  title=${json(s.session_title)}`
      );
    }
    log(
      `Chose session_id ${chosen.session_id} (most recent regular session). Re-run with --session <id> to pick another.`
    );
    sessionId = chosen.session_id;
  }

  const body = await callLegiScan(
    "getMasterList",
    { id: String(sessionId) },
    apiKey,
    fetchJson
  );

  const findings = extractFindings(body);
  const report = formatFindings(findings, sessionId);
  assertNoSecret(report, apiKey);
  log("");
  log(report);

  const fixture = `${json(trimMasterList(body))}\n`;
  assertNoSecret(fixture, apiKey);
  await writeFile(args.out, fixture);
  log("");
  log(
    `Wrote ${args.out} (session + ${Math.min(FIXTURE_ROW_COUNT, findings.rowCount)} rows). Review it before committing.`
  );
  return findings;
}

/** CLI entry: returns the process exit code. */
export async function main(deps: CaptureDeps): Promise<number> {
  try {
    await runCapture(deps);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (deps.error ?? console.error)(
      `[legiscan-capture] ${redactSecret(message, deps.env.LEGISCAN_API_KEY?.trim())}`
    );
    return 1;
  }
}
