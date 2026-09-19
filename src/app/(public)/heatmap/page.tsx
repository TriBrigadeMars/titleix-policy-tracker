import { getHeatmapSummaries } from "@/lib/queries";
import { StateHeatmap } from "@/components/state-heatmap";

export const dynamic = "force-dynamic";

export default async function HeatmapPage() {
  const summaries = await getHeatmapSummaries();

  return <StateHeatmap summaries={summaries} />;
}
