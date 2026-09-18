import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawInstrument } from "./types";

const { upsert, findMany, $transaction } = vi.hoisted(() => ({
  upsert: vi.fn(),
  findMany: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    jurisdiction: { findMany },
    instrument: { upsert },
    $transaction,
  },
}));

import { upsertInstruments } from "./upsert";

function raw(overrides: Partial<RawInstrument> = {}): RawInstrument {
  return {
    jurisdictionCode: "US",
    type: "BILL",
    identifier: "119-HR-1234",
    title: "Test Bill",
    status: "PROPOSED",
    introducedAt: null,
    passedAt: null,
    effectiveAt: null,
    sourceUrl: "https://www.congress.gov/bill/119th-congress/hr/1234",
    rawSummary: null,
    ...overrides,
  };
}

function jurisdictionRow(code: string, id: string) {
  return { id, code };
}

/**
 * $transaction runs the callback immediately (mock). Each upsert call returns
 * a row whose createdAt/updatedAt indicate whether it was a create or update.
 */
function setupTransaction() {
  $transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    return cb({ instrument: { upsert } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([
    jurisdictionRow("US", "jur_US"),
    jurisdictionRow("CA", "jur_CA"),
  ]);
  setupTransaction();
  upsert.mockResolvedValue({
    id: "inst-1",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2025-01-01"),
  });
});

describe("upsertInstruments — empty input", () => {
  it("returns zeros without touching the database", async () => {
    const result = await upsertInstruments([]);
    expect(result).toEqual({ created: 0, updated: 0, skipped: 0, total: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("upsertInstruments — jurisdiction resolution", () => {
  it("queries only the unique jurisdiction codes", async () => {
    await upsertInstruments([
      raw({ jurisdictionCode: "US" }),
      raw({ jurisdictionCode: "US", identifier: "119-HR-5678" }),
      raw({ jurisdictionCode: "CA", identifier: "CA-AB-123" }),
    ]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: { in: ["US", "CA"] } },
      })
    );
  });

  it("skips rows whose jurisdiction code is not in the database", async () => {
    const unknown = raw({ jurisdictionCode: "XX", identifier: "XX-1" });
    upsert.mockResolvedValue({
      id: "inst-1",
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-02"),
    });

    const result = await upsertInstruments([unknown]);

    expect(result.skipped).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("upsertInstruments — upsert arguments", () => {
  it("upserts on (jurisdictionId, type, identifier)", async () => {
    const now = new Date();
    upsert.mockResolvedValue({
      id: "inst-1",
      createdAt: now,
      updatedAt: now,
    });

    await upsertInstruments([raw()]);

    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      jurisdictionId_type_identifier: {
        jurisdictionId: "jur_US",
        type: "BILL",
        identifier: "119-HR-1234",
      },
    });
  });

  it("creates with all machine-known fields", async () => {
    const now = new Date();
    upsert.mockResolvedValue({
      id: "inst-1",
      createdAt: now,
      updatedAt: now,
    });

    await upsertInstruments([
      raw({
        title: "Amended Title",
        status: "PASSED",
        passedAt: "2025-01-10T00:00:00.000Z",
        sourceUrl: "https://example.com",
      }),
    ]);

    const call = upsert.mock.calls[0][0];
    expect(call.create.jurisdictionId).toBe("jur_US");
    expect(call.create.type).toBe("BILL");
    expect(call.create.identifier).toBe("119-HR-1234");
    expect(call.create.title).toBe("Amended Title");
    expect(call.create.status).toBe("PASSED");
    expect(call.create.passedAt).toEqual(new Date("2025-01-10T00:00:00.000Z"));
    expect(call.create.sourceUrl).toBe("https://example.com");
    expect(call.create.lastCheckedAt).toBeInstanceOf(Date);
  });

  it("update does not set isTitleIXRelevant or relevanceConfidence", async () => {
    const now = new Date();
    upsert.mockResolvedValue({
      id: "inst-1",
      createdAt: new Date("2024-01-01"),
      updatedAt: now,
    });

    await upsertInstruments([raw()]);

    const call = upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty("isTitleIXRelevant");
    expect(call.update).not.toHaveProperty("relevanceConfidence");
    expect(call.update).not.toHaveProperty("jurisdictionId");
    expect(call.update.lastCheckedAt).toBeInstanceOf(Date);
  });
});

describe("upsertInstruments — result counts", () => {
  it("counts a row as created when createdAt equals updatedAt", async () => {
    const now = new Date();
    upsert.mockResolvedValue({
      id: "inst-1",
      createdAt: now,
      updatedAt: now,
    });

    const result = await upsertInstruments([raw()]);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
  });

  it("counts a row as updated when createdAt differs from updatedAt", async () => {
    upsert.mockResolvedValue({
      id: "inst-1",
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2025-01-01"),
    });

    const result = await upsertInstruments([raw()]);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
  });

  it("returns the total and skips", async () => {
    upsert.mockResolvedValue({
      id: "inst-1",
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2025-01-01"),
    });

    const result = await upsertInstruments([
      raw(),
      raw({ jurisdictionCode: "XX", identifier: "XX-1" }),
    ]);
    expect(result.total).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(1);
  });
});
