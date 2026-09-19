import type { IngestAdapter, RawInstrument } from "@/lib/ingest";

interface CongressBill {
  congress: number;
  number: string;
  type: string;
  title: string;
  introducedDate?: string;
  latestAction?: { actionDate?: string; text?: string };
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
export function mapCongressBills(json: unknown): RawInstrument[] {
  const bills =
    typeof json === "object" && json !== null && "bills" in json
      ? (json as { bills?: unknown }).bills
      : undefined;
  if (!Array.isArray(bills)) return [];

  const rows: RawInstrument[] = [];
  for (const bill of bills) {
    if (!isCongressBill(bill)) continue;
    const slug = getCongressBillSlug(bill.type);
    rows.push({
      jurisdictionCode: "US",
      type: "BILL",
      identifier: `${bill.type}-${bill.number}-${bill.congress}`,
      // The spec only drops bills on bad identifier fields; a non-string
      // title still yields a row, so fall back to an empty title.
      title: typeof bill.title === "string" ? bill.title : "",
      status: "PROPOSED",
      introducedAt:
        typeof bill.introducedDate === "string" ? bill.introducedDate : null,
      passedAt: null,
      effectiveAt: null,
      sourceUrl: `https://www.congress.gov/bill/${bill.congress}th-congress/${slug}/${bill.number}`,
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
    const congress = opts?.congress ?? 119;
    const limit = opts?.limit ?? 50;
    let url = `${CONGRESS_GOV_BILLS_URL}?congress=${congress}&limit=${limit}`;
    const apiKey = process.env.CONGRESS_GOV_API_KEY;
    if (apiKey) url += `&api_key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Congress.gov request failed with status ${res.status}`
      );
    }
    return mapCongressBills(await res.json());
  },
};
