import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { PublicReadOnlyNote } from "@/components/public-readonly-note";
import { EmptyTrackerNotice } from "@/components/empty-tracker-notice";
import { getHeatmapSummaries, getPublicFreshness } from "@/lib/queries";
import { StateHeatmap } from "@/components/state-heatmap";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "National Heatmap — Title IX Policy Tracker",
  description:
    "Title IX legislative activity across all 50 states and the federal government.",
};

export default async function HeatmapPage() {
  // The heatmap is read-only for everyone: the session only decides whether to
  // explain that to a signed-out visitor. No editor controls belong here.
  const session = await auth();
  const [summaries, freshness] = await Promise.all([
    getHeatmapSummaries(),
    getPublicFreshness(),
  ]);

  return (
    <>
      {!session?.user && <PublicReadOnlyNote />}
      {summaries.every((s) => s.relevantCount === 0) && <EmptyTrackerNotice />}
      <StateHeatmap summaries={summaries} freshness={freshness} />
    </>
  );
}
