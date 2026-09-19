import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast-path gate for unauthenticated requests.
 *
 * This only checks whether a session cookie is *present*; it does not verify
 * the session. The authoritative checks are `src/app/(protected)/layout.tsx`
 * for pages and `src/lib/auth-guards.ts` for API routes.
 *
 * We deliberately avoid calling `auth()` here: sessions are stored in the
 * database (Prisma adapter), and the edge runtime cannot reach it.
 */

const PUBLIC_PREFIXES = ["/sign-in", "/heatmap", "/api/auth"];

/**
 * Exact paths that are public. The comparison matrix lives at `/`, so this is
 * matched exactly: a prefix match on "/" would make `/triage` and `/admin`
 * public too.
 */
const PUBLIC_EXACT = ["/"];

const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

/** Whether `pathname` is readable without a session. */
export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const hasSessionCookie = SESSION_COOKIES.some((name) =>
    request.cookies.has(name)
  );

  if (hasSessionCookie) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const signInUrl = new URL("/sign-in", request.url);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};