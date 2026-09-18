import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/db";
import { toUserSummary, userSummarySelect } from "@/lib/queries";
import { formatIssues, userRoleUpdateSchema } from "@/lib/validation";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireRole("ADMIN");
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = userRoleUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: formatIssues(parsed.error) },
      { status: 400 }
    );
  }

  const { role } = parsed.data;

  // Prevent admin self-demotion
  if (guard.user.id === id && role !== "ADMIN") {
    return NextResponse.json(
      { error: "Admins cannot demote their own account" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { role },
    select: userSummarySelect,
  });

  return NextResponse.json(toUserSummary(updated));
}
