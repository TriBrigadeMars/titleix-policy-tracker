import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests need a real Postgres. They are gated on TEST_DATABASE_URL
// so `npm test` still passes without one; when it is set, point Prisma at the
// same database so the module under test uses the real client.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {},
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
});
