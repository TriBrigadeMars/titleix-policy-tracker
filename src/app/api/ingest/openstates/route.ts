import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guards";
import { upsertInstruments } from "@/lib/ingest";
import { openStatesAdapter } from "@/lib/ingest/openstates";

const MAX_INGEST_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const DEFAULT_JURISDICTION = "nc";

function paramInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Trigger an OpenStates bill ingest. ADMIN-only.
 *
 * Query params:
 *   jurisdiction – state jurisdiction slug (default "nc")
 *   session      – optional session identifier
 *   limit        – max bills to ingest (default 50, capped at 100)
 */
export async function POST(request: Request) {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const jurisdiction = params.get("jurisdiction") ?? DEFAULT_JURISDICTION;
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

    const rows = await openStatesAdapter.fetch(options);
    const result = await upsertInstruments(rows);
    return NextResponse.json({ source: openStatesAdapter.name, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingest failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}