import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guards";
import { openStatesAdapter } from "@/lib/ingest/openstates";
import { filterCandidates } from "@/lib/ingest/candidate-filter";
import { runIngest } from "@/lib/ingest/pipeline";
import { INGEST_GENERIC_ERROR, paramInt } from "@/lib/ingest/route-helpers";

const MAX_INGEST_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/**
 * Trigger an OpenStates bill ingest. ADMIN-only.
 *
 * Query params:
 *   jurisdiction – required state jurisdiction slug (e.g. "nc")
 *   session      – optional session identifier
 *   limit        – max bills to ingest (default 50, capped at 100). OpenStates
 *                  returns one page per request; higher `limit` values still
 *                  require pagination support to ingest more than one page.
 */
export async function POST(request: Request) {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const jurisdiction = params.get("jurisdiction");
  if (!jurisdiction) {
    return NextResponse.json(
      { error: "jurisdiction query parameter is required" },
      { status: 400 }
    );
  }
  const session = params.get("session");
  const limit = paramInt(
    params.get("limit"),
    DEFAULT_LIMIT,
    1,
    MAX_INGEST_LIMIT
  );

  try {
    const options: Record<string, string | number> = { jurisdiction, limit };
    if (session) options.session = session;

    const result = await runIngest(openStatesAdapter.name, async () =>
      filterCandidates(await openStatesAdapter.fetch(options))
    );
    return NextResponse.json({
      source: openStatesAdapter.name,
      ...result,
      limit,
    });
  } catch (error) {
    console.error("[ingest/openstates] failed", error);
    return NextResponse.json(
      { error: INGEST_GENERIC_ERROR },
      { status: 502 }
    );
  }
}
