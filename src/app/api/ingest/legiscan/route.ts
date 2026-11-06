import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guards";
import { legiScanAdapter } from "@/lib/ingest/legiscan";
import { runIngest } from "@/lib/ingest/pipeline";
import { INGEST_GENERIC_ERROR, paramInt } from "@/lib/ingest/route-helpers";

const MAX_INGEST_LIMIT = 5000;

/**
 * Trigger a LegiScan bill ingest. ADMIN-only.
 *
 * Query params:
 *   id    – LegiScan session id (takes precedence over `state`)
 *   state – two-letter state abbreviation (used when `id` is absent)
 *   limit – optional cap on bills ingested, for admin testing (default: the
 *           entire session; `getMasterList` is a full session dump, so omitting
 *           `limit` never truncates coverage)
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
    const result = await runIngest(legiScanAdapter.name, () =>
      legiScanAdapter.fetch({
        ...(id ? { id } : state ? { state } : {}),
        ...(limit === undefined ? {} : { limit }),
      })
    );
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
