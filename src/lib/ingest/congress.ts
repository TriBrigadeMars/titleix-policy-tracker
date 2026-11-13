import { FETCH_TIMEOUT_MS, type IngestAdapter, type RawInstrument } from "@/lib/ingest";

interface CongressBill {
  congress: number;
  number: string;
  type: string;
  title: string;
  introducedDate?: string;
  latestAction?: { actionDate?: string; text?: string };
}

export interface CongressStatusResult {
  status: "PROPOSED" | "PASSED" | "VETOED" | "FAILED";
  passedAt?: "use-action-date";
}

const CONGRESS_GOV_BILLS_URL = "https://api.congress.gov/v3/bill";

const CONGRESS_BILL_TYPE_SLUGS: Record<string, string> = {
  HR: "house-bill",
  S: "senate-bill",
  HJRES: "house-joint-resolution",
  SJRES: "senate-joint-resolution",
  HCONRES: "house-concurrent-resolution",
  SCONRES: "senate-concurrent-resolution",
  HRES: "house-resolution",
  SRES: "senate-resolution",
};

export function getCongressBillSlug(type: string): string {
  return CONGRESS_BILL_TYPE_SLUGS[type.toUpperCase()] ?? type.toLowerCase();
}

export function ordinal(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${n}th`;
  }
  const mod10 = abs % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

export function congressStatusFromLatestAction(
  text: string | undefined
): CongressStatusResult {
  if (!text) {
    return { status: "PROPOSED" };
  }
  const lower = text.toLowerCase();
  if (lower.includes("became public law")) {
    return { status: "PASSED", passedAt: "use-action-date" };
  }
  if (lower.includes("vetoed by president") || lower.includes("pocket vetoed")) {
    return { status: "VETOED" };
  }
  if (lower.includes("failed of passage")) {
    return { status: "FAILED" };
  }
  return { status: "PROPOSED" };
}

function isCongressBill(value: unknown): value is CongressBill {
  if (typeof value !== "object" || value === null) return false;
  const bill = value as Record<string, unknown>;
  return (
    typeof bill.type === "string" &&
    typeof bill.number === "string" &&
    typeof bill.congress === "number"
  );
}

/**
 * Map a parsed Congress.gov bills-list response to raw instruments. Pure: no
 * I/O, no database. Malformed bills (missing or wrongly-typed type, number, or
 * congress) are skipped, never thrown.
 */
export function mapCongressBills(
  json: unknown,
  requestedCongress?: number
): RawInstrument[] {
  const bills =
    typeof json === "object" && json !== null && "bills" in json
      ? (json as { bills?: unknown }).bills
      : undefined;
  if (!Array.isArray(bills)) return [];

  const rows: RawInstrument[] = [];
  for (const bill of bills) {
    if (!isCongressBill(bill)) continue;
    if (requestedCongress !== undefined && bill.congress !== requestedCongress) {
      continue;
    }
    const slug = getCongressBillSlug(bill.type);
    const identifier = `${bill.type}-${bill.number}-${bill.congress}`;
    const statusResult = congressStatusFromLatestAction(bill.latestAction?.text);
    const passedAt =
      statusResult.status === "PASSED" &&
      typeof bill.latestAction?.actionDate === "string"
        ? bill.latestAction.actionDate
        : null;

    rows.push({
      jurisdictionCode: "US",
      type: "BILL",
      identifier,
      source: "congress",
      sourceId: identifier,
      // The spec only drops bills on bad identifier fields; a non-string
      // title still yields a row, so fall back to an empty title.
      title: typeof bill.title === "string" ? bill.title : "",
      status: statusResult.status,
      introducedAt:
        typeof bill.introducedDate === "string" ? bill.introducedDate : null,
      passedAt,
      effectiveAt: null,
      sourceUrl: `https://www.congress.gov/bill/${ordinal(bill.congress)}-congress/${slug}/${bill.number}`,
      rawSummary:
        typeof bill.latestAction?.text === "string"
          ? bill.latestAction.text
          : null,
    });
  }
  return rows;
}

export const congressAdapter: IngestAdapter = {
  name: "congress.gov",
  async fetch(opts) {
    const congress = Number(opts?.congress ?? 119);
    const limit = Number(opts?.limit ?? 50);
    const offset = Number(opts?.offset ?? 0);

    if (
      !Number.isInteger(congress) ||
      !Number.isInteger(limit) ||
      !Number.isInteger(offset)
    ) {
      throw new Error("congress, limit, and offset must be integers");
    }

    const apiKey = process.env.CONGRESS_GOV_API_KEY;
    if (!apiKey) {
      // Fail closed: without a key the request would be anonymous and may be
      // silently rate-limited or rejected, producing misleading empty ingests.
      throw new Error(
        "CONGRESS_GOV_API_KEY is not set; see .env.example for instructions"
      );
    }

    let url = `${CONGRESS_GOV_BILLS_URL}/${congress}?format=json&limit=${limit}`;
    if (offset > 0) {
      url += `&offset=${offset}`;
    }
    url += `&api_key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(
        `Congress.gov request failed with status ${res.status}`
      );
    }
    return mapCongressBills(await res.json(), congress);
  },
};
