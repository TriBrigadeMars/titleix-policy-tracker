import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-guards";
import {
  instrumentWithNotesInclude,
  toInstrument,
} from "@/lib/queries";
import { formatIssues, instrumentTriageSchema } from "@/lib/validation";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireRole("EDITOR");
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing instrument id" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = instrumentTriageSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: formatIssues(parsed.error) },
      { status: 400 }
    );
  }

  const { isTitleIXRelevant, relevanceConfidence, issueTagIds } = parsed.data;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // First ensure the instrument exists
      const existing = await tx.instrument.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) {
        return null;
      }

      // Sync issue tags
      await tx.instrumentIssueTag.deleteMany({
        where: { instrumentId: id },
      });

      if (issueTagIds.length > 0) {
        await tx.instrumentIssueTag.createMany({
          data: issueTagIds.map((issueTagId) => ({
            instrumentId: id,
            issueTagId,
          })),
        });
      }

      // Update relevance and confidence
      return tx.instrument.update({
        where: { id },
        data: {
          isTitleIXRelevant,
          relevanceConfidence: relevanceConfidence ?? null,
        },
        include: instrumentWithNotesInclude,
      });
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Instrument not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(toInstrument(updated));
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return NextResponse.json(
        { error: "Unknown issue tag" },
        { status: 400 }
      );
    }
    throw error;
  }
}
