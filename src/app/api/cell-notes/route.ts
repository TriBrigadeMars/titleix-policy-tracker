import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, requireRole } from "@/lib/auth-guards";
import { parseComparisonQuery } from "@/lib/search-params";
import {
  cellNoteInclude,
  getCellNotesForComparison,
} from "@/lib/queries";
import { cellNoteUpsertSchema, formatIssues } from "@/lib/validation";

export async function GET(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const parsed = parseComparisonQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const cellNotes = await getCellNotesForComparison(parsed);
  return NextResponse.json(cellNotes);
}

/**
 * Create or replace the note for one (jurisdiction, issue tag) cell.
 *
 * `CellNote` is unique on that pair, so this is an upsert rather than a
 * create/update split. `authorId` always comes from the session and never from
 * the request body.
 */
export async function PUT(request: Request) {
  const guard = await requireRole("EDITOR");
  if (!guard.ok) return guard.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = cellNoteUpsertSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: formatIssues(parsed.error) },
      { status: 400 }
    );
  }

  const { jurisdictionId, issueTagId, body } = parsed.data;

  try {
    const cellNote = await prisma.cellNote.upsert({
      where: { jurisdictionId_issueTagId: { jurisdictionId, issueTagId } },
      create: { jurisdictionId, issueTagId, body, authorId: guard.user.id },
      // authorId is deliberately absent: the cell keeps crediting whoever first
      // wrote it, and updatedAt is what signals a later revision.
      update: { body },
      include: cellNoteInclude,
    });

    return NextResponse.json(cellNote);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return NextResponse.json(
        { error: "Unknown jurisdiction or issue tag" },
        { status: 400 }
      );
    }
    throw error;
  }
}

/** Remove a cell note. Requires EDITOR. */
export async function DELETE(request: Request) {
  const guard = await requireRole("EDITOR");
  if (!guard.ok) return guard.response;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // deleteMany rather than delete: it reports a count instead of throwing when
  // the id is already gone.
  const { count } = await prisma.cellNote.deleteMany({ where: { id } });
  if (count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}