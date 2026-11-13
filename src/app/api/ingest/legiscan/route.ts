import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guards";
import { legiScanAdapter } from "@/lib/ingest/legiscan";
import { filterCandidates } from "@/lib/ingest/candidate-filter";
import { runIngest } from "@/lib/ingest/pipeline";
import { INGEST_GENERIC_ERROR, paramInt } from "@/lib/ingest/route-helpers";

const MAX_INGEST_LIMIT = 5000;

/**
 * Trigger a LegiScan bill ingest. ADMIN-only.
 *
 * Query params:
 *   id    – LegiScan session id (takes precedence over `state`)
 *   state – two-letter state abbreviation (used when `id` is absent)
 *   limit – optional cap on Title IX candidates kept, for admin testing. It is
 *           applied after the keyword filter runs over the entire session, so
 *           it never hides a match; omitted, every candidate is kept.
 */
export async function POST(request: Request) {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const state = params.get("state");
  const limitParam = params.get("limit");
  const limit =
    limitParam === null
      ? undefined
      : paramInt(limitParam, 1, 1, MAX_INGEST_LIMIT);

  try {
    // Filter the whole master list first; `limit` caps kept rows only, so a
    // match deep in the session is never truncated away before the filter.
    const result = await runIngest(legiScanAdapter.name, async () => {
      const scan = filterCandidates(
        await legiScanAdapter.fetch(id ? { id } : state ? { state } : {})
      );
      return limit === undefined
        ? scan
        : { kept: scan.kept.slice(0, limit), scanned: scan.scanned };
    });
    return NextResponse.json({
      source: legiScanAdapter.name,
      ...result,
      ...(limit === undefined ? {} : { limit }),
    });
  } catch (error) {
    console.error("[ingest/legiscan] failed", error);
    return NextResponse.json(
      { error: INGEST_GENERIC_ERROR },
      { status: 502 }
    );
  }
}
