import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
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

  /**
   * Server-component guard for pages that require at least `role`.
   *
   * Different from {@link requireRole}: that returns a `NextResponse` for API
   * route handlers, whereas a page must issue a navigation redirect. The
   * signed-in gate lives in `(protected)/layout.tsx`; this only enforces the
   * role, so it assumes authentication has already succeeded and redirects to
   * "/".
   *
   * Throws (via `redirect`) when the guard fails, so it is not a return-value
   * helper. Call it at the top of a page component and let the throw unwind.
   * Returns the authenticated session on success so callers can read the user
   * without a second `auth()` round-trip.
   */
  export async function requirePageRole(role: UserRole) {
    const session = await auth();
    if (!session?.user || !hasRole(session.user.role, role)) {
      redirect("/");
    }
    return session;
  }