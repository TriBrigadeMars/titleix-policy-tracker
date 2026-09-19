import { auth } from "@/lib/auth";
import { PublicReadOnlyNote } from "@/components/public-readonly-note";
import { getHeatmapSummaries } from "@/lib/queries";
import { StateHeatmap } from "@/components/state-heatmap";

export const dynamic = "force-dynamic";

export default async function HeatmapPage() {
  // The heatmap is read-only for everyone: the session only decides whether to
  // explain that to a signed-out visitor. No editor controls belong here.
  const session = await auth();
  const summaries = await getHeatmapSummaries();

  return (
    <>
      {!session?.user && <PublicReadOnlyNote />}
      <StateHeatmap summaries={summaries} />
    </>
  );
}
