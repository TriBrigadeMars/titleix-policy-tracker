import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guards";
import { upsertInstruments } from "@/lib/ingest";
import { legiScanAdapter } from "@/lib/ingest/legiscan";

const GENERIC_ERROR = "Ingest failed. Check server logs for details.";

/**
 * Trigger a LegiScan bill ingest. ADMIN-only.
 *
 * Query params:
 *   id    – LegiScan session id (takes precedence over `state`)
 *   state – two-letter state abbreviation (used when `id` is absent)
 */
export async function POST(request: Request) {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const state = params.get("state");

  try {
    const rows = await legiScanAdapter.fetch(
      id ? { id } : state ? { state } : {}
    );
    const result = await upsertInstruments(rows);
    return NextResponse.json({ source: legiScanAdapter.name, ...result });
  } catch (error) {
    console.error("[ingest/legiscan] failed", error);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 502 });
  }
}