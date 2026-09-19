import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-guards";
import { formatIssues, instrumentNoteCreateSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const guard = await requireRole("EDITOR");
  if (!guard.ok) return guard.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = instrumentNoteCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: formatIssues(parsed.error) },
      { status: 400 }
    );
  }

  const { instrumentId, body } = parsed.data;

  try {
    const note = await prisma.instrumentNote.create({
      data: {
        instrumentId,
        body,
        authorId: guard.user.id,
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(
      {
        id: note.id,
        instrumentId: note.instrumentId,
        authorId: note.authorId,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
        author: note.author ? { id: note.author.id, name: note.author.name } : null,
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return NextResponse.json(
        { error: "Unknown instrument" },
        { status: 400 }
      );
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const guard = await requireRole("EDITOR");
  if (!guard.ok) return guard.response;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const { count } = await prisma.instrumentNote.deleteMany({
    where: { id },
  });

  if (count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
