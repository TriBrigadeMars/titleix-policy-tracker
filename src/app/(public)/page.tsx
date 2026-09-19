import { auth } from "@/lib/auth";
import { Dashboard } from "@/components/dashboard";
import { PublicReadOnlyNote } from "@/components/public-readonly-note";
import {
  getCellNotesForComparison,
  getInstrumentsForComparison,
  getIssueTags,
  getJurisdictions,
} from "@/lib/queries";
import { canEditRole } from "@/lib/roles";
import {
  MAX_COMPARISON_JURISDICTIONS,
  parseIdList,
} from "@/lib/search-params";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ j?: string | string[] }>;
}) {
  const session = await auth();
  const canEdit = canEditRole(session);
  const params = await searchParams;
  const raw = Array.isArray(params.j) ? params.j.join(",") : (params.j ?? null);
  const requestedCodes = parseIdList(raw).slice(
    0,
    MAX_COMPARISON_JURISDICTIONS
  );

  const jurisdictions = await getJurisdictions();
  const byCode = new Map(jurisdictions.map((j) => [j.code, j]));
  const selected = requestedCodes.flatMap((code) => {
    const match = byCode.get(code);
    return match ? [match] : [];
  });

  const canCompare = selected.length >= 2;
  const selectedIds = selected.map((j) => j.id);

  const [issueTags, instruments, cellNotes] = canCompare
    ? await Promise.all([
        getIssueTags(),
        getInstrumentsForComparison({ jurisdictionIds: selectedIds }),
        getCellNotesForComparison({ jurisdictionIds: selectedIds }),
      ])
    : [[], [], []];

  return (
    <>
      {!session?.user && <PublicReadOnlyNote />}
      <Dashboard
        canEdit={canEdit}
        jurisdictions={jurisdictions}
        selectedCodes={selected.map((j) => j.code)}
        issueTags={issueTags}
        instruments={instruments}
        cellNotes={cellNotes}
      />
    </>
  );
}
