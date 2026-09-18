export function formatDate(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString();
}
