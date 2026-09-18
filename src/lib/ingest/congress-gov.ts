import type { InstrumentStatus } from "@/types";
import type { RawInstrument } from "./types";

/**
 * Congress.gov bill list response (list level, not item level).
 * Only the fields we read are typed; the API returns more.
 *
 * @see https://github.com/LibraryOfCongress/api.congress.gov
 */
export interface CongressBillListResponse {
  bills: CongressBill[];
  pagination?: {
    count: number;
    next?: string;
  };
}

export interface CongressBill {
  congress: number;
  type: string;
  number: number;
  title: string;
  originChamber?: string;
  updateDate?: string;
  latestAction?: {
    actionDate?: string;
    text?: string;
  };
  url?: string;
}

const FEDERAL_JURISDICTION_CODE = "US";

const BILL_TYPE_REGEX = /^(HR|S|HJRES|SJRES|HCONRES|SCONRES|HRES|SRES)$/i;

/**
 * Infer an `InstrumentStatus` from the latest action text. Congress.gov does
 * not give a structured status at the list level, so this is a best-effort
 * heuristic for machine ingest. Human editors triage and correct later.
 *
 * The heuristics intentionally err on the side of PROPOSED: a bill that has
 * passed one chamber but not both is still PROPOSESED from a federal-law
 * perspective.
 */
export function inferBillStatus(latestActionText: string | undefined): InstrumentStatus {
  if (!latestActionText) return "PROPOSED";

  const text = latestActionText;

  if (/Became Public Law/i.test(text)) return "PASSED";
  if (/Signed by (the )?President/i.test(text)) return "PASSED";
  if (/Enacted(?: Over| pursuant)/i.test(text)) return "PASSED";
  if (/Vetoed by (the )?President/i.test(text)) return "ENJOINED";
  if (/Repealed/i.test(text)) return "REPEALED";

  return "PROPOSED";
}

/**
 * Build the human-facing Congress.gov URL for a bill.
 */
export function billSourceUrl(bill: { congress: number; type: string; number: number }): string {
  const typeLower = bill.type.toLowerCase();
  return `https://www.congress.gov/bill/${bill.congress}th-congress/${typeLower}/${bill.number}`;
}

/**
 * Build the stable identifier for a bill: `${congress}-${type}-${number}`.
 * This is unique across all congresses and bill types, so it serves as the
 * Prisma unique key for the `(jurisdictionId, type, identifier)` constraint.
 */
export function billIdentifier(bill: { congress: number; type: string; number: number }): string {
  return `${bill.congress}-${bill.type.toUpperCase()}-${bill.number}`;
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Pure mapping from a Congress.gov bill (list level) to a `RawInstrument`.
 * No I/O — fully testable with fixtures.
 *
 * `introducedAt` is not available at the list level (it requires a per-bill
 * item request). We leave it null here; a future enhancement can fetch item
 * details. `passedAt` is inferred from the latest action when it indicates
 * passage.
 */
export function mapBillToRawInstrument(bill: CongressBill): RawInstrument {
  if (!BILL_TYPE_REGEX.test(bill.type)) {
    throw new Error(`Unknown bill type: ${bill.type}`);
  }

  const status = inferBillStatus(bill.latestAction?.text);
  const passedAt =
    status === "PASSED" ? parseDate(bill.latestAction?.actionDate) : null;

  return {
    jurisdictionCode: FEDERAL_JURISDICTION_CODE,
    type: "BILL",
    identifier: billIdentifier(bill),
    title: bill.title,
    status,
    introducedAt: null,
    passedAt,
    effectiveAt: null,
    sourceUrl: billSourceUrl(bill),
    rawSummary: null,
  };
}

/**
 * Congress.gov adapter. Fetches federal bills for a given congress (defaults to
 * the current congress, 119) and maps them to `RawInstrument[]`.
 *
 * The HTTP fetch is a thin layer; the mapping logic lives in the pure
 * `mapBillToRawInstrument` function. Tests cover the mapper with fixtures;
 * the fetch is exercised by the API route at runtime.
 */
export class CongressGovAdapter {
  readonly name = "congress-gov";

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly congress: number;
  private readonly limit: number;

  constructor(opts: {
    apiKey: string;
    congress?: number;
    limit?: number;
    baseUrl?: string;
  }) {
    if (!opts.apiKey) throw new Error("CongressGovAdapter requires an apiKey");
    this.apiKey = opts.apiKey;
    this.congress = opts.congress ?? 119;
    this.limit = Math.min(opts.limit ?? 250, 250);
    this.baseUrl = opts.baseUrl ?? "https://api.congress.gov/v3";
  }

  async fetch(): Promise<RawInstrument[]> {
    const url = new URL(`/v3/bill/${this.congress}`, this.baseUrl);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("limit", String(this.limit));
    url.searchParams.set("sort", "updateDate desc");
    url.searchParams.set("format", "json");

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(
        `Congress.gov API error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as CongressBillListResponse;
    return data.bills.map(mapBillToRawInstrument);
  }
}
