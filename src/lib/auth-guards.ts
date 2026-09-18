import { NextResponse } from "next/server";
import { auth } from "./auth";
import { hasRole, type UserRole } from "./roles";

export interface SessionUser {
  id: string;
  role: UserRole;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export type GuardResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

/**
 * Resolve the signed-in user, or a 401 response when there is none.
 *
 * Usage:
 *   const guard = await requireUser();
 *   if (!guard.ok) return guard.response;
 *   // guard.user is narrowed to SessionUser
 */
export async function requireUser(): Promise<GuardResult> {
  const session = await auth();

  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, user: session.user };
}

/**
 * Resolve the signed-in user, requiring at least `role`.
 * Returns 401 when unauthenticated and 403 when the role is insufficient.
 */
export async function requireRole(role: UserRole): Promise<GuardResult> {
  const guard = await requireUser();
  if (!guard.ok) return guard;

  if (!hasRole(guard.user.role, role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return guard;
}