/**
 * Public comparison URL for an editor who just tagged an instrument.
 * The matrix needs two columns, so a state is always paired with federal.
 */
export function publicCellHref(
  jurisdictionCode: string,
  issueSlug?: string | null
): string {
  const codes =
    jurisdictionCode === "US" ? "US,CA" : `US,${jurisdictionCode}`;
  const hash = issueSlug ? `#issue-${issueSlug}` : "";
  return `/?j=${codes}${hash}`;
}
