import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, sourceFindMany, update, upsert, $transaction } = vi.hoisted(() => ({
  findMany: vi.fn(),
  sourceFindMany: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  $transaction: vi.fn(),
}));

const txClient = {
  instrument: { upsert, findMany: sourceFindMany, update },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    jurisdiction: { findMany },
    instrument: { upsert, findMany: sourceFindMany, update },
    $transaction,
  },
}));

import { upsertInstruments, INGEST_CHUNK_SIZE, chunk, type RawInstrument } from "./index";

const usRow: RawInstrument = {
  jurisdictionCode: "US",
  type: "BILL",
  identifier: "HR-1234-119",
  title: "A bill",
  status: "PROPOSED",
  introducedAt: "2025-01-04",
  passedAt: null,
  effectiveAt: null,
  sourceUrl: "https://www.congress.gov/bill/119th-congress/HR/1234",
  rawSummary: "Some action text",
};

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([{ id: "us-1", code: "US" }]);
  upsert.mockResolvedValue({ id: "created-1" });
  sourceFindMany.mockResolvedValue([]);
  update.mockResolvedValue({ id: "existing-1" });
  $transaction.mockImplementation(
    async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)
  );
});

describe("chunk", () => {
  it("splits a list into fixed-size batches with a short remainder", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single batch when the list is smaller than the size", () => {
    expect(chunk([1, 2], 50)).toEqual([[1, 2]]);
  });

  it("returns no batches for an empty list", () => {
    expect(chunk([], 50)).toEqual([]);
  });
});

describe("upsertInstruments", () => {
  it("returns zero counts for an empty batch", async () => {
    const result = await upsertInstruments([]);
    expect(result).toEqual({ total: 0, upserted: 0, skipped: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it("resolves jurisdiction codes in one query", async () => {
    await upsertInstruments([usRow]);
    expect(findMany).toHaveBeenCalledWith({
      where: { code: { in: ["US"] } },
      select: { id: true, code: true },
    });
  });

  it("queries only the distinct codes, not duplicates", async () => {
    await upsertInstruments([usRow, { ...usRow, identifier: "HR-2-119" }]);
    const codes = findMany.mock.calls[0][0].where.code.in;
    expect(codes).toEqual(["US"]);
  });

  it("upserts on the unique (jurisdictionId, type, identifier) key", async () => {
    await upsertInstruments([usRow]);
    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      jurisdictionId_type_identifier: {
        jurisdictionId: "us-1",
        type: "BILL",
        identifier: "HR-1234-119",
      },
    });
  });

  it("overwrites source-owned fields on update but never editor fields", async () => {
    await upsertInstruments([usRow]);
    const call = upsert.mock.calls[0][0];
      expect(call.update).not.toHaveProperty("triageStatus");
    expect(call.update).not.toHaveProperty("relevanceConfidence");
      expect(call.update).toHaveProperty("status", "PROPOSED");
    expect(call.update).toHaveProperty("title", "A bill");
    expect(call.update).toHaveProperty("lastCheckedAt");
  });

    it("refreshes lifecycle status when the source reports a new one", async () => {
      await upsertInstruments([{ ...usRow, status: "PASSED" }]);
    const call = upsert.mock.calls[0][0];
      expect(call.update).toHaveProperty("status", "PASSED");
    });

    it("defaults triage to UNREVIEWED on create and omits confidence", async () => {
      await upsertInstruments([usRow]);
      const call = upsert.mock.calls[0][0];
      expect(call.create.triageStatus).toBe("UNREVIEWED");
      expect(call.create).not.toHaveProperty("relevanceConfidence");
    });

  it("skips rows whose jurisdiction code is not in the database", async () => {
    const unknownRow: RawInstrument = { ...usRow, jurisdictionCode: "ZZ" };
    const result = await upsertInstruments([usRow, unknownRow]);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ total: 2, upserted: 1, skipped: 1 });
  });

  it("runs all upserts inside a single transaction", async () => {
    await upsertInstruments([usRow]);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 30_000 }
    );
  });

  it("converts ISO date strings to Date objects and nulls stay null", async () => {
    await upsertInstruments([usRow]);
    const call = upsert.mock.calls[0][0];
    expect(call.create.introducedAt).toBeInstanceOf(Date);
    expect(call.create.passedAt).toBeNull();
    expect(call.create.effectiveAt).toBeNull();
  });

  it("commits one transaction per chunk when rows exceed INGEST_CHUNK_SIZE", async () => {
    const rows = Array.from({ length: INGEST_CHUNK_SIZE * 2 + 1 }, (_, i) => ({
      ...usRow,
      identifier: `HR-${i}-119`,
    }));

    const result = await upsertInstruments(rows);

    expect($transaction).toHaveBeenCalledTimes(3);
    expect(upsert).toHaveBeenCalledTimes(101);
    expect(result).toEqual({ total: 101, upserted: 101, skipped: 0 });
  });

  it("keeps earlier chunks committed and rethrows when a later chunk fails", async () => {
    const rows = Array.from({ length: INGEST_CHUNK_SIZE * 2 }, (_, i) => ({
      ...usRow,
      identifier: `HR-${i}-119`,
    }));
    $transaction
      .mockImplementationOnce(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient))
      .mockRejectedValueOnce(new Error("btree index row size exceeds maximum"));

    await expect(upsertInstruments(rows)).rejects.toThrow(
      /btree index row size exceeds maximum/
    );
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it("rejects and does not count upserted when the third upsert of a chunk rejects", async () => {
    const rows = [
      { ...usRow, identifier: "HR-1-119" },
      { ...usRow, identifier: "HR-2-119" },
      { ...usRow, identifier: "HR-3-119" },
      { ...usRow, identifier: "HR-4-119" },
    ];
    upsert
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("third upsert failed"));

    await expect(upsertInstruments(rows)).rejects.toThrow("third upsert failed");
    expect(upsert).toHaveBeenCalledTimes(3);
  });

  it("commits earlier chunk and does not count upserted for failing chunk when third upsert rejects", async () => {
    const chunk1Rows = Array.from({ length: INGEST_CHUNK_SIZE }, (_, i) => ({
      ...usRow,
      identifier: `HR-1-${i}-119`,
    }));
    const chunk2Rows = [
      { ...usRow, identifier: "HR-2-1-119" },
      { ...usRow, identifier: "HR-2-2-119" },
      { ...usRow, identifier: "HR-2-3-119" },
      { ...usRow, identifier: "HR-2-4-119" },
    ];

    let count = 0;
    upsert.mockImplementation(async () => {
      count += 1;
      if (count === INGEST_CHUNK_SIZE + 3) {
        throw new Error("third upsert of second chunk failed");
      }
      return {};
    });

    await expect(
      upsertInstruments([...chunk1Rows, ...chunk2Rows])
    ).rejects.toThrow("third upsert of second chunk failed");

    expect($transaction).toHaveBeenCalledTimes(2);
  });
});


it("looks up source pairs once per chunk and updates matching rows in place", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ ...usRow, source: "legiscan", sourceId: String(i), identifier: `US-s22-AB${i}` }));
  sourceFindMany.mockResolvedValueOnce([{ id: "existing-1", source: "legiscan", sourceId: "0" }]);
  await upsertInstruments(rows);
  expect(sourceFindMany).toHaveBeenCalledTimes(2);
  expect(sourceFindMany.mock.calls[0][0].where.OR).toHaveLength(50);
  expect(update).toHaveBeenCalledWith({ where: { id: "existing-1" }, data: expect.objectContaining({ identifier: "US-s22-AB0" }) });
  expect(upsert).toHaveBeenCalledTimes(50);
});
