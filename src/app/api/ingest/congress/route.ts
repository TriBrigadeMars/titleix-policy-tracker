import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guards";
import { upsertInstruments } from "@/lib/ingest";
import { congressAdapter } from "@/lib/ingest/congress";

const MAX_INGEST_LIMIT = 100;
const DEFAULT_CONGRESS = 119;
const DEFAULT_LIMIT = 50;

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
 * Trigger a Congress.gov bill ingest. ADMIN-only: this is a bulk write, not
 * editorial triage. Machines bring in raw rows; editors tag relevance.
 *
 * Query params:
 *   congress – congress number (default 119)
 *   limit    – max bills to ingest (default 50, capped at 100)
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
    const rows = await congressAdapter.fetch({ congress, limit });
    const result = await upsertInstruments(rows);
    return NextResponse.json({ source: congressAdapter.name, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingest failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
