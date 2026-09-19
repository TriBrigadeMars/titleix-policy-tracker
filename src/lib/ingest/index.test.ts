import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, upsert, $transaction } = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    jurisdiction: { findMany },
    instrument: { upsert },
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
  upsert.mockResolvedValue({});
  $transaction.mockImplementation(async (ops: unknown[]) =>
    Promise.all(ops as Promise<unknown>[])
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

  it("overwrites machine fields on update but never editor fields or status", async () => {
    await upsertInstruments([usRow]);
    const call = upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty("isTitleIXRelevant");
    expect(call.update).not.toHaveProperty("relevanceConfidence");
    expect(call.update).not.toHaveProperty("status");
    expect(call.update).toHaveProperty("title", "A bill");
    expect(call.update).toHaveProperty("lastCheckedAt");
  });

  it("defaults isTitleIXRelevant to false on create and omits confidence", async () => {
    await upsertInstruments([usRow]);
    const call = upsert.mock.calls[0][0];
    expect(call.create.isTitleIXRelevant).toBe(false);
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
    expect(Array.isArray($transaction.mock.calls[0][0])).toBe(true);
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
    expect(
      ($transaction.mock.calls[0][0] as unknown[]).length
    ).toBe(INGEST_CHUNK_SIZE);
    expect(
      ($transaction.mock.calls[2][0] as unknown[]).length
    ).toBe(1);
    expect(result).toEqual({ total: 101, upserted: 101, skipped: 0 });
  });

  it("keeps earlier chunks committed and rethrows when a later chunk fails", async () => {
    const rows = Array.from({ length: INGEST_CHUNK_SIZE * 2 }, (_, i) => ({
      ...usRow,
      identifier: `HR-${i}-119`,
    }));
    $transaction
      .mockImplementationOnce(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]))
      .mockRejectedValueOnce(new Error("btree index row size exceeds maximum"));

    await expect(upsertInstruments(rows)).rejects.toThrow(
      /btree index row size exceeds maximum/
    );
    expect($transaction).toHaveBeenCalledTimes(2);
  });
});
