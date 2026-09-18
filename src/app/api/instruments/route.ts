import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jurisdictionIds = searchParams.get("jurisdictionIds")?.split(",") ?? [];
  const issueTagIds = searchParams.get("issueTagIds")?.split(",") ?? [];

  const where: Record<string, unknown> = {};

  if (jurisdictionIds.length > 0) {
    where.jurisdictionId = { in: jurisdictionIds };
  }

  if (issueTagIds.length > 0) {
    where.issueTags = {
      some: {
        issueTagId: { in: issueTagIds },
      },
    };
  }

  const instruments = await prisma.instrument.findMany({
    where,
    include: {
      jurisdiction: true,
      issueTags: {
        include: { issueTag: true },
      },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  return NextResponse.json(instruments);
}