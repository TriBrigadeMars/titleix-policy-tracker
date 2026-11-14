import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    const headers = buildSecurityHeaders({
      production: process.env.NODE_ENV === "production",
      localMode: process.env.TITLEIX_LOCAL_MODE === "1",
    });
    const hsts = headers.filter((header) => header.key === "Strict-Transport-Security");
    return [
      {
        source: "/:path*",
        headers: headers.filter((header) => header.key !== "Strict-Transport-Security"),
      },
      // Headers are compiled at build time. The same hosted build is staged
      // for desktop, where both UDS proxies always send Host: tracker.
      ...(hsts.length ? [{
        source: "/:path*",
        missing: [{ type: "host" as const, value: "tracker" }],
        headers: hsts,
      }] : []),
    ];
  },
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite", "pglite-prisma-adapter"],
};

export default nextConfig;
