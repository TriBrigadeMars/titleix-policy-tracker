import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const jurisdictions = await prisma.jurisdiction.findMany({
    orderBy: [{ level: "asc" }, { code: "asc" }],
  });

  return NextResponse.json(jurisdictions);
}