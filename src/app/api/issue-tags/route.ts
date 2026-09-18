import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guards";
import { getIssueTags } from "@/lib/queries";

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  return NextResponse.json(await getIssueTags());
}