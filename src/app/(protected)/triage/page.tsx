import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TriageDashboard } from "@/components/triage-dashboard";
import {
  getInstrumentsForTriage,
  getIssueTags,
  getJurisdictions,
} from "@/lib/queries";
import { hasRole } from "@/lib/roles";
import { parseTriageQuery } from "@/lib/search-params";

export const dynamic = "force-dynamic";

export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<{
    jurisdiction?: string;
    status?: string;
    relevance?: string;
    limit?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "EDITOR")) {
    redirect("/");
  }

  const params = await searchParams;
  const urlParams = new URLSearchParams();
  if (params.jurisdiction) urlParams.set("jurisdiction", params.jurisdiction);
  if (params.status) urlParams.set("status", params.status);
  if (params.relevance) urlParams.set("relevance", params.relevance);
  if (params.limit) urlParams.set("limit", params.limit);

  const filters = parseTriageQuery(urlParams);

  const [jurisdictions, issueTags, instruments] = await Promise.all([
    getJurisdictions(),
    getIssueTags(),
    getInstrumentsForTriage(filters),
  ]);

  return (
    <TriageDashboard
      jurisdictions={jurisdictions}
      issueTags={issueTags}
      initialInstruments={instruments}
      filters={filters}
    />
  );
}
