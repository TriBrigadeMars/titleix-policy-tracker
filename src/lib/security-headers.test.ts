import { expect, it } from "vitest";
import { buildSecurityHeaders } from "./security-headers";

it("protects production HTML and API responses", () => {
  const headers = Object.fromEntries(buildSecurityHeaders({ production: true, localMode: false }).map(({ key, value }) => [key, value]));
  expect(headers).toMatchObject({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  });
  const csp = headers["Content-Security-Policy"];
  for (const directive of ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: https:", "font-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self' https://accounts.google.com", "object-src 'none'"]) {
    expect(csp.split("; ")).toContain(directive);
  }
  expect(csp).not.toContain("'unsafe-eval'");
});

it("allows eval only during development and omits HSTS in local mode", () => {
  const dev = buildSecurityHeaders({ production: false, localMode: true });
  expect(dev.find((h) => h.key === "Content-Security-Policy")?.value).toContain("'unsafe-eval'");
  expect(dev.some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  const local = buildSecurityHeaders({ production: true, localMode: true });
  expect(local.some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  expect(local.find((h) => h.key === "Content-Security-Policy")?.value).not.toContain("'unsafe-eval'");
});

it("excludes desktop transport hosts even when packaging a hosted build", async () => {
  const { default: config } = await import("../../next.config");
  const rules = await config.headers!();
  expect(rules[0].source).toBe("/:path*");
  expect(rules[0].headers.some((h) => h.key === "Content-Security-Policy")).toBe(true);
  expect(rules[0].headers.some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  const hstsRule = rules.find((r) => r.headers.some((h) => h.key === "Strict-Transport-Security"));
  expect(hstsRule?.missing).toEqual([{ type: "host", value: "tracker" }]);
});
