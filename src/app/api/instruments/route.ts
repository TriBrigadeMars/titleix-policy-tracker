import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-guards";
import { parseIdList } from "@/lib/search-params";

export async function GET(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const jurisdictionIds = parseIdList(searchParams.get("jurisdictionIds"));
  const issueTagIds = parseIdList(searchParams.get("issueTagIds"));

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