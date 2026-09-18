import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-guards";

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const jurisdictions = await prisma.jurisdiction.findMany({
    orderBy: [{ level: "asc" }, { code: "asc" }],
  });

  return NextResponse.json(jurisdictions);
}