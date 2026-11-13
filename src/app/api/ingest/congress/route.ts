import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guards";
import { congressAdapter } from "@/lib/ingest/congress";
import { filterCandidates } from "@/lib/ingest/candidate-filter";
import { runIngest } from "@/lib/ingest/pipeline";
import { INGEST_GENERIC_ERROR, paramInt } from "@/lib/ingest/route-helpers";

const MAX_INGEST_LIMIT = 100;
const DEFAULT_CONGRESS = 119;
const DEFAULT_LIMIT = 50;

/**
 * Trigger a Congress.gov bill ingest. ADMIN-only: this is a bulk write, not
 * editorial triage. Machines bring in raw rows; editors tag relevance.
 *
 * Query params:
 *   congress – congress number (default 119)
 *   limit    – bills fetched, one page (default 50, capped at 100); only
 *              Title IX candidates from that page are upserted
 */
export async function POST(request: Request) {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const congress = paramInt(params.get("congress"), DEFAULT_CONGRESS, 1, 999);
  const limit = paramInt(
    params.get("limit"),
    DEFAULT_LIMIT,
    1,
    MAX_INGEST_LIMIT
  );

  try {
    // One page; the keyword filter runs on the whole page before upsert.
    const result = await runIngest(congressAdapter.name, async () =>
      filterCandidates(await congressAdapter.fetch({ congress, limit }))
    );
    return NextResponse.json({
      source: congressAdapter.name,
      ...result,
      limit,
    });
  } catch (error) {
    // Log server-side; the response body stays generic.
    console.error("[ingest/congress] failed", error);
    return NextResponse.json(
      { error: INGEST_GENERIC_ERROR },
      { status: 502 }
    );
  }
}
