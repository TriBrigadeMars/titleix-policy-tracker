function parseValidDate(value: string | Date): Date | null {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Formats dates deterministically in UTC (`M/D/YYYY`) without `Intl` or host
 * locale/timezone dependence so SSR HTML and client hydration always match.
 */
export function formatDate(value: string | Date): string {
  const parsed = parseValidDate(value);
  if (!parsed) return "";
  const month = parsed.getUTCMonth() + 1;
  const day = parsed.getUTCDate();
  const year = parsed.getUTCFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Formats timestamps deterministically in UTC (`M/D/YYYY, H:MM:SS AM/PM UTC`)
 * so SSR and client hydration produce identical text across all timezones.
 */
export function formatDateTime(value: string | Date): string {
  const parsed = parseValidDate(value);
  if (!parsed) return "";
  const datePart = formatDate(parsed);
  const rawHours = parsed.getUTCHours();
  const period = rawHours >= 12 ? "PM" : "AM";
  const hours12 = rawHours % 12 || 12;
  const minutes = pad2(parsed.getUTCMinutes());
  const seconds = pad2(parsed.getUTCSeconds());
  return `${datePart}, ${hours12}:${minutes}:${seconds} ${period} UTC`;
}

