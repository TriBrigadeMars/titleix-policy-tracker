import type { RawInstrument } from "./index";

/**
 * Phrases that mark a bill as a Title IX *candidate*. Editors still decide
 * `RELEVANT`. This list only shrinks the unreviewed queue before upsert.
 *
 * Keep terms specific. A word like "education" would still ingest a session.
 */
export const TITLE_IX_TERMS = [
  "title ix",
  "title 9",
  "titleix",
  "education amendments of 1972",
  "sex discrimination",
  "sexual harassment",
  "gender identity",
  "sexual orientation",
  "transgender athlete",
  "transgender student",
  "women and girls in sports",
  "girls in sports",
  "women's sports",
  "womens sports",
  "athletics eligibility",
  "sex-separated",
  "sex separated",
  "biological sex",
  "locker room",
  "locker rooms",
  "pregnant student",
  "pregnancy discrimination",
  "parental status",
  "dear colleague",
  "office for civil rights",
  "title ix coordinator",
] as const;

export function normalizeCandidateText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NORMALIZED_TITLE_IX_TERMS = TITLE_IX_TERMS.map(normalizeCandidateText);

export function matchesTitleIxTerms(
  title: string,
  summary?: string | null
): boolean {
  const haystack = normalizeCandidateText(
    `${title} ${summary ?? ""}`
  );
  if (!haystack) return false;
  return NORMALIZED_TITLE_IX_TERMS.some((term) => haystack.includes(term));
}

export function selectCandidates(rows: RawInstrument[]): {
  kept: RawInstrument[];
  dropped: number;
} {
  const kept: RawInstrument[] = [];
  let dropped = 0;
  for (const row of rows) {
    if (matchesTitleIxTerms(row.title, row.rawSummary)) {
      kept.push(row);
    } else {
      dropped += 1;
    }
  }
  return { kept, dropped };
}

/**
 * Rows that passed the Title IX candidate filter, plus how many raw rows were
 * examined to find them. `scanned - kept.length` is what a run records as
 * `dropped`.
 */
export interface CandidateScan {
  kept: RawInstrument[];
  scanned: number;
}

/** Filter an already-fetched list. For callers that fetch a single page. */
export function filterCandidates(rows: RawInstrument[]): CandidateScan {
  return { kept: selectCandidates(rows).kept, scanned: rows.length };
}
