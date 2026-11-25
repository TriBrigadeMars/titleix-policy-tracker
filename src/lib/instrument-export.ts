import type { Instrument } from "@/types";

/** UTF-8 BOM so Excel on Windows reads non-ASCII titles as UTF-8. */
export const CSV_BOM = "\uFEFF";

export const CSV_COLUMNS = [
  "jurisdiction_code",
  "jurisdiction_name",
  "type",
  "identifier",
  "title",
  "status",
  "introduced_at",
  "passed_at",
  "effective_at",
  "last_checked_at",
  "source",
  "source_id",
  "source_url",
  "issue_tags",
  "summary",
] as const;

/** RFC 4180 quoting: only fields with a delimiter, quote, or newline need it. */
export function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function rowFor(instrument: Instrument): string[] {
  return [
    instrument.jurisdiction.code,
    instrument.jurisdiction.name,
    instrument.type,
    instrument.identifier,
    instrument.title,
    instrument.status,
    instrument.introducedAt ?? "",
    instrument.passedAt ?? "",
    instrument.effectiveAt ?? "",
    instrument.lastCheckedAt ?? "",
    instrument.source ?? "",
    instrument.sourceId ?? "",
    instrument.sourceUrl ?? "",
    instrument.issueTags.map((link) => link.issueTag.label).join("; "),
    instrument.rawSummary ?? "",
  ];
}

/**
 * Deterministic CSV of the public instrument fields. Timestamps stay ISO-8601
 * so downstream scripts do not have to reinterpret a locale.
 */
export function formatInstrumentCsv(instruments: Instrument[]): string {
  const lines = [
    CSV_COLUMNS.join(","),
    ...instruments.map((instrument) => rowFor(instrument).map(csvEscape).join(",")),
  ];
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

export interface InstrumentExportRecord {
  id: string;
  jurisdictionCode: string;
  jurisdictionName: string;
  type: Instrument["type"];
  identifier: string;
  title: string;
  status: Instrument["status"];
  introducedAt: string | null;
  passedAt: string | null;
  effectiveAt: string | null;
  lastCheckedAt: string | null;
  source: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  summary: string | null;
  issueTags: { slug: string; label: string }[];
}

export interface InstrumentExportPayload {
  generatedAt: string;
  count: number;
  truncated: boolean;
  instruments: InstrumentExportRecord[];
}

export function toExportRecords(
  instruments: Instrument[]
): InstrumentExportRecord[] {
  return instruments.map((instrument) => ({
    id: instrument.id,
    jurisdictionCode: instrument.jurisdiction.code,
    jurisdictionName: instrument.jurisdiction.name,
    type: instrument.type,
    identifier: instrument.identifier,
    title: instrument.title,
    status: instrument.status,
    introducedAt: instrument.introducedAt,
    passedAt: instrument.passedAt,
    effectiveAt: instrument.effectiveAt,
    lastCheckedAt: instrument.lastCheckedAt,
    source: instrument.source ?? null,
    sourceId: instrument.sourceId ?? null,
    sourceUrl: instrument.sourceUrl ?? null,
    summary: instrument.rawSummary ?? null,
    issueTags: instrument.issueTags.map((link) => ({
      slug: link.issueTag.slug,
      label: link.issueTag.label,
    })),
  }));
}

export function toExportPayload(
  instruments: Instrument[],
  generatedAt: string,
  truncated: boolean
): InstrumentExportPayload {
  return {
    generatedAt,
    count: instruments.length,
    truncated,
    instruments: toExportRecords(instruments),
  };
}
