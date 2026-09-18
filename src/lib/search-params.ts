/** Parse a comma-separated query param into a trimmed, non-empty id list. */
export function parseIdList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}