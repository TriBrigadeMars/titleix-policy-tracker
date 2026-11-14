export function normalizeBillNumber(number: string): string {
  return number.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

interface CensusBill {
  id: string;
  jurisdictionId: string;
  identifier: string;
  source: string | null;
}

/** Read-only candidates for human review, not a cross-source identity key. */
export function findProbableDuplicates<T extends CensusBill>(rows: T[]): [T, T][] {
  const groups = new Map<string, T[]>();
  const pairs: [T, T][] = [];
  for (const row of rows) {
    if (!row.source) continue;
    const number = normalizeBillNumber(row.identifier.split("-").at(-1) ?? "");
    if (!number) continue;
    const key = JSON.stringify([row.jurisdictionId, number]);
    const group = groups.get(key) ?? [];
    for (const previous of group) {
      if (previous.source !== row.source) pairs.push([previous, row]);
    }
    group.push(row);
    groups.set(key, group);
  }
  return pairs;
}
