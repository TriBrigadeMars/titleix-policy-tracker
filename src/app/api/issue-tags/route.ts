import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const issueTags = await prisma.issueTag.findMany({
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json(issueTags);
}