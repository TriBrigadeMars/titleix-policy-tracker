import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveDatabaseMode } from "./db";

const { mockFindMany, mockBootstrapLocalPGlite } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockBootstrapLocalPGlite: vi.fn().mockResolvedValue({
    prisma: {
      instrument: {
        findMany: vi.fn().mockResolvedValue([{ id: "pglite-record" }]),
      },
    },
  }),
}));

vi.mock("@prisma/client", () => {
  return {
    PrismaClient: class {
      instrument = {
        findMany: mockFindMany,
      };
      $transaction = vi.fn();
      $queryRaw = vi.fn();
      $executeRaw = vi.fn();
      $connect = vi.fn();
      $disconnect = vi.fn();
    },
  };
});

vi.mock("./local-runtime/pglite-bootstrap", () => ({
  bootstrapLocalPGlite: mockBootstrapLocalPGlite,
}));

describe("Database client hardening tests (Task 01)", () => {
  const originalEnv = { ...process.env };
  const env = process.env as Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).prisma;
    delete (globalThis as Record<string, unknown>).__localDbHandlePromise;
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    delete (globalThis as Record<string, unknown>).prisma;
    delete (globalThis as Record<string, unknown>).__localDbHandlePromise;
  });

  describe("Test 1: Pure mode resolution function", () => {
    it("returns embedded-disk when localMode is active regardless of other variables", () => {
      // Row 1: TITLEIX_LOCAL_MODE=1 -> Embedded PGlite on disk
      expect(
        resolveDatabaseMode({
          localMode: "1",
          databaseUrl: "postgresql://user:pass@localhost:5432/db",
          nodeEnv: "production",
        })
      ).toBe("embedded-disk");

      expect(
        resolveDatabaseMode({
          localMode: true,
          databaseUrl: undefined,
          nodeEnv: "development",
        })
      ).toBe("embedded-disk");

      expect(
        resolveDatabaseMode({
          localMode: "true",
          databaseUrl: "   ",
          nodeEnv: "test",
        })
      ).toBe("embedded-disk");
    });

    it("returns postgres when DATABASE_URL is set and non-empty (not local mode)", () => {
      // Row 2: DATABASE_URL set -> Real Postgres
      expect(
        resolveDatabaseMode({
          databaseUrl: "postgresql://user:pass@localhost:5432/db",
          nodeEnv: "production",
        })
      ).toBe("postgres");

      expect(
        resolveDatabaseMode({
          databaseUrl: "postgresql://localhost:5432/test",
          nodeEnv: "development",
        })
      ).toBe("postgres");

      expect(
        resolveDatabaseMode({
          localMode: "0",
          databaseUrl: "postgresql://localhost:5432/test",
          nodeEnv: "production",
        })
      ).toBe("postgres");

      expect(
        resolveDatabaseMode({
          localMode: false,
          databaseUrl: "postgresql://localhost:5432/test",
          nodeEnv: "test",
        })
      ).toBe("postgres");
    });

    it("returns embedded-memory when no DATABASE_URL or whitespace-only in non-production", () => {
      // Row 3: No DATABASE_URL, NODE_ENV !== "production" -> Embedded in-memory
      expect(
        resolveDatabaseMode({
          databaseUrl: undefined,
          nodeEnv: "development",
        })
      ).toBe("embedded-memory");

      expect(
        resolveDatabaseMode({
          databaseUrl: "",
          nodeEnv: "test",
        })
      ).toBe("embedded-memory");

      expect(
        resolveDatabaseMode({
          databaseUrl: "   \t\n  ",
          nodeEnv: "development",
        })
      ).toBe("embedded-memory");

      expect(
        resolveDatabaseMode({
          databaseUrl: undefined,
          nodeEnv: undefined,
        })
      ).toBe("embedded-memory");

      expect(
        resolveDatabaseMode({
          databaseUrl: "   ",
          nodeEnv: "",
        })
      ).toBe("embedded-memory");
    });

    it("returns unconfigured when no DATABASE_URL or whitespace-only in production (not local mode)", () => {
      // Row 4: No DATABASE_URL, NODE_ENV === "production", not local mode -> unconfigured
      expect(
        resolveDatabaseMode({
          databaseUrl: undefined,
          nodeEnv: "production",
        })
      ).toBe("unconfigured");

      expect(
        resolveDatabaseMode({
          databaseUrl: "",
          nodeEnv: "production",
        })
      ).toBe("unconfigured");

      expect(
        resolveDatabaseMode({
          databaseUrl: "   \t\n  ",
          nodeEnv: "production",
        })
      ).toBe("unconfigured");

      expect(
        resolveDatabaseMode({
          localMode: "0",
          databaseUrl: "   ",
          nodeEnv: "production",
        })
      ).toBe("unconfigured");
    });
  });

  describe("Test 2 & 3: Postgres mode error propagation and lack of sticky state", () => {
    it("Test 2: With a mocked PrismaClient whose instrument.findMany rejects with P1001, exported prisma.instrument.findMany() rejects with the same error and bootstrapLocalPGlite is never called", async () => {
      env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      delete env.TITLEIX_LOCAL_MODE;
      env.NODE_ENV = "production";

      vi.resetModules();
      const { prisma } = await import("./db");

      const p1001Error = { code: "P1001", message: "Can't reach database server" };
      mockFindMany.mockRejectedValueOnce(p1001Error);

      await expect(prisma.instrument.findMany()).rejects.toMatchObject({
        code: "P1001",
      });

      expect(mockBootstrapLocalPGlite).not.toHaveBeenCalled();
    });

    it("Test 3: A second call after that failure still goes to the real client (no sticky state)", async () => {
      env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
      delete env.TITLEIX_LOCAL_MODE;
      env.NODE_ENV = "production";

      vi.resetModules();
      const { prisma } = await import("./db");

      const p1001Error = { code: "P1001", message: "Can't reach database server" };
      mockFindMany.mockRejectedValueOnce(p1001Error);

      // Call 1 fails
      await expect(prisma.instrument.findMany()).rejects.toMatchObject({
        code: "P1001",
      });

      // Call 2 succeeds on real client
      mockFindMany.mockResolvedValueOnce([{ id: "real-record-2" }]);
      const result = await prisma.instrument.findMany();

      expect(result).toEqual([{ id: "real-record-2" }]);
      expect(mockFindMany).toHaveBeenCalledTimes(2);
      expect(mockBootstrapLocalPGlite).not.toHaveBeenCalled();
    });
  });

  describe("Test 4: Unconfigured mode in production", () => {
    it("importing the module does not throw, and a query rejects with clear error message", async () => {
      delete env.DATABASE_URL;
      delete env.TITLEIX_LOCAL_MODE;
      env.NODE_ENV = "production";

      vi.resetModules();
      // Importing must not throw
      const { prisma } = await import("./db");
      expect(prisma).toBeDefined();

      const expectedMsg =
        "DATABASE_URL is not set. Refusing to start without a database in production.";

      await expect(prisma.instrument.findMany()).rejects.toThrow(expectedMsg);
      await expect(prisma.$queryRaw`SELECT 1`).rejects.toThrow(expectedMsg);
      await expect(prisma.$transaction(async () => {})).rejects.toThrow(
        expectedMsg
      );
      await expect(prisma.$connect()).rejects.toThrow(expectedMsg);
      await expect(prisma.$disconnect()).rejects.toThrow(expectedMsg);

      expect(mockBootstrapLocalPGlite).not.toHaveBeenCalled();
    });

    it("whitespace-only DATABASE_URL in production also rejects on query without throwing on import", async () => {
      env.DATABASE_URL = "   \t\n  ";
      delete env.TITLEIX_LOCAL_MODE;
      env.NODE_ENV = "production";

      vi.resetModules();
      const { prisma } = await import("./db");
      expect(prisma).toBeDefined();

      const expectedMsg =
        "DATABASE_URL is not set. Refusing to start without a database in production.";

      await expect(prisma.instrument.findMany()).rejects.toThrow(expectedMsg);
      expect(mockBootstrapLocalPGlite).not.toHaveBeenCalled();
    });
  });

  describe("Embedded runtime modes (local & dev)", () => {
    it("uses embedded on disk when TITLEIX_LOCAL_MODE=1", async () => {
      env.TITLEIX_LOCAL_MODE = "1";
      delete env.DATABASE_URL;
      delete env.NODE_ENV;

      vi.resetModules();
      const { prisma } = await import("./db");

      await prisma.instrument.findMany();
      expect(mockBootstrapLocalPGlite).toHaveBeenCalledWith({ inMemory: false });
    });

    it("uses embedded in memory in development without DATABASE_URL", async () => {
      delete env.TITLEIX_LOCAL_MODE;
      delete env.DATABASE_URL;
      env.NODE_ENV = "development";

      vi.resetModules();
      const { prisma } = await import("./db");

      await prisma.instrument.findMany();
      expect(mockBootstrapLocalPGlite).toHaveBeenCalledWith({ inMemory: true });
    });
  });
});
