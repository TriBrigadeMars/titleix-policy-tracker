import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRealTransaction, mockEmbeddedTransaction } = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  return {
    mockRealTransaction: vi.fn(),
    mockEmbeddedTransaction: vi.fn(),
  };
});

vi.mock("@prisma/client", () => {
  return {
    PrismaClient: class {
      $transaction = mockRealTransaction;
    },
  };
});

vi.mock("./local-runtime/pglite-bootstrap", () => ({
  bootstrapLocalPGlite: vi.fn().mockResolvedValue({
    prisma: {
      $transaction: mockEmbeddedTransaction,
    },
  }),
}));

describe("db.ts $transaction proxy handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an array argument with the specified error message", async () => {
    const { prisma } = await import("./db");

    await expect(
      prisma.$transaction([Promise.resolve("query")] as unknown as Parameters<
        typeof prisma.$transaction
      >[0])
    ).rejects.toThrow(
      "Batch $transaction([...]) is not supported; use the interactive form"
    );

    await expect(
      prisma.$transaction([] as unknown as Parameters<
        typeof prisma.$transaction
      >[0])
    ).rejects.toThrow(
      "Batch $transaction([...]) is not supported; use the interactive form"
    );

    expect(mockRealTransaction).not.toHaveBeenCalled();
    expect(mockEmbeddedTransaction).not.toHaveBeenCalled();
  });

  it("forwards the callback and options argument to the real client", async () => {
    const { prisma } = await import("./db");
    mockRealTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({ mockedTx: true })
    );

    const callback = vi.fn().mockResolvedValue("real-success");
    const options = { timeout: 30_000, maxWait: 5_000 };

    const result = await prisma.$transaction(
      callback as unknown as Parameters<typeof prisma.$transaction>[0],
      options
    );

    expect(result).toBe("real-success");
    expect(mockRealTransaction).toHaveBeenCalledWith(callback, options);
  });

  it("propagates a real-client transaction error without failing over", async () => {
    const { prisma } = await import("./db");
    const offline = {
      name: "PrismaClientInitializationError",
      message: "Can't reach database server",
    };
    mockRealTransaction.mockRejectedValueOnce(offline);

    await expect(
      prisma.$transaction(
        vi.fn() as unknown as Parameters<typeof prisma.$transaction>[0],
        { timeout: 15_000 }
      )
    ).rejects.toBe(offline);
    expect(mockEmbeddedTransaction).not.toHaveBeenCalled();
  });

  it("forwards the callback and options argument to the embedded client", async () => {
    const savedUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete (globalThis as Record<string, unknown>).prisma;
    vi.resetModules();
    try {
      const { prisma } = await import("./db");
      mockEmbeddedTransaction.mockImplementation(
        async (fn: (tx: unknown) => Promise<unknown>) => fn({ embeddedTx: true })
      );

      const callback = vi.fn().mockResolvedValue("embedded-success");
      const options = { timeout: 15_000 };

      const result = await prisma.$transaction(
        callback as unknown as Parameters<typeof prisma.$transaction>[0],
        options
      );

      expect(result).toBe("embedded-success");
      expect(mockEmbeddedTransaction).toHaveBeenCalledWith(callback, options);
      expect(mockRealTransaction).not.toHaveBeenCalled();
    } finally {
      process.env.DATABASE_URL = savedUrl;
      delete (globalThis as Record<string, unknown>).prisma;
      vi.resetModules();
    }
  });
});
