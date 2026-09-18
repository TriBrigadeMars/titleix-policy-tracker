import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guards";
import { getInstrumentsForComparison } from "@/lib/queries";
import { parseComparisonQuery } from "@/lib/search-params";

export async function GET(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const parsed = parseComparisonQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const instruments = await getInstrumentsForComparison(parsed);
  return NextResponse.json(instruments);
}