import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isPublicPath, middleware } from "./middleware";

const SESSION_COOKIE = "authjs.session-token";

function request(pathname: string, withCookie = false): NextRequest {
  const headers = new Headers();
  if (withCookie) {
    headers.set("cookie", `${SESSION_COOKIE}=fake-session-token`);
  }
  return new NextRequest(new URL(`http://localhost:3000${pathname}`), {
    headers,
  });
}

/** `NextResponse.next()` carries this header; redirects and JSON do not. */
function isNext(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

describe("isPublicPath", () => {
  it("treats the read-only pages as public", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/heatmap")).toBe(true);
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/api/auth")).toBe(true);
    expect(isPublicPath("/api/auth/session")).toBe(true);
  });

  it("does not make protected routes public", () => {
    // A prefix match on "/" would wrongly allow every path here.
    expect(isPublicPath("/triage")).toBe(false);
    expect(isPublicPath("/admin")).toBe(false);
    expect(isPublicPath("/api/cell-notes")).toBe(false);
  });
});

describe("middleware without a session cookie", () => {
  it("allows the comparison matrix and heatmap", () => {
    expect(isNext(middleware(request("/")))).toBe(true);
    expect(isNext(middleware(request("/heatmap")))).toBe(true);
    expect(isNext(middleware(request("/heatmap?scope=state")))).toBe(true);
  });

  it("allows the sign-in page and auth routes", () => {
    expect(isNext(middleware(request("/sign-in")))).toBe(true);
    expect(isNext(middleware(request("/api/auth/session")))).toBe(true);
  });

  it("redirects /triage and /admin to sign-in", () => {
    for (const pathname of ["/triage", "/admin"]) {
      const response = middleware(request(pathname));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/sign-in"
      );
    }
  });

  it("returns 401 for data APIs", () => {
    const response = middleware(request("/api/cell-notes"));
    expect(response.status).toBe(401);
    expect(isNext(response)).toBe(false);
  });
});

describe("middleware with a session cookie", () => {
  it("allows every page through the fast path", () => {
    for (const pathname of ["/", "/heatmap", "/triage", "/admin"]) {
      expect(isNext(middleware(request(pathname, true)))).toBe(true);
    }
  });

  it("allows data APIs through to the authoritative guard", () => {
    expect(isNext(middleware(request("/api/cell-notes", true)))).toBe(true);
  });
});
