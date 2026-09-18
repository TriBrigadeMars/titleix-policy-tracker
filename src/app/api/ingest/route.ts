import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guards";
import { CongressGovAdapter } from "@/lib/ingest/congress-gov";
import { upsertInstruments } from "@/lib/ingest/upsert";

/**
 * Trigger an ingest run. ADMIN only.
 *
 * Query params:
 *   congress — congress number (defaults to 119, the current congress)
 *
 * Returns the upsert counts so the caller can see what landed.
 */
export async function POST(request: Request) {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return guard.response;

  const apiKey = process.env.CONGRESS_GOV_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "CONGRESS_GOV_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const congressParam = new URL(request.url).searchParams.get("congress");
  const congress = congressParam ? Number(congressParam) : undefined;
  if (congress !== undefined && (!Number.isInteger(congress) || congress < 1)) {
    return NextResponse.json(
      { error: "congress must be a positive integer" },
      { status: 400 }
    );
  }

  const adapter = new CongressGovAdapter({ apiKey, congress });
  const raw = await adapter.fetch();
  const result = await upsertInstruments(raw);

  return NextResponse.json(result);
}
