import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawInstrument } from "@/lib/ingest";

const { create, update, findFirst, upsertInstruments } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findFirst: vi.fn(),
  upsertInstruments: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    ingestRun: { create, update, findFirst },
  },
}));

vi.mock("@/lib/ingest", () => ({
  upsertInstruments,
}));

import { filterCandidates } from "./candidate-filter";
import {
  classifyIngestError,
  getLastSuccessfulRunAt,
  runIngest,
} from "./pipeline";

const keptRow: RawInstrument = {
  jurisdictionCode: "US",
  type: "BILL",
  identifier: "HR-1-119",
  title: "Title IX athletics eligibility",
  status: "PROPOSED",
  introducedAt: null,
  passedAt: null,
  effectiveAt: null,
  sourceUrl: null,
  rawSummary: null,
};

const droppedRow: RawInstrument = {
  ...keptRow,
  identifier: "HR-2-119",
  title: "Highway funding authorization",
};

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: "run-1" });
  update.mockResolvedValue({ id: "run-1" });
  upsertInstruments.mockResolvedValue({ total: 1, upserted: 1, skipped: 0 });
});

describe("classifyIngestError", () => {
  it("maps missing keys, timeouts, and upstream failures", () => {
    expect(
      classifyIngestError(new Error("CONGRESS_GOV_API_KEY is not set"))
    ).toBe("MissingApiKey");
    expect(classifyIngestError(new Error("The operation was aborted"))).toBe(
      "UpstreamTimeout"
    );
    expect(
      classifyIngestError(new Error("Congress.gov request failed with status 503"))
    ).toBe("UpstreamError");
    expect(classifyIngestError(new Error("LegiScan ingest requires a session id"))).toBe(
      "MissingSessionId"
    );
  });
});

describe("runIngest", () => {
  it("drops non-candidates, upserts the rest, and records SUCCESS", async () => {
    const result = await runIngest("congress.gov", async () =>
      filterCandidates([keptRow, droppedRow])
    );

    expect(upsertInstruments).toHaveBeenCalledWith([keptRow]);
    expect(update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "SUCCESS",
        upserted: 1,
        skipped: 0,
        dropped: 1,
      }),
    });
    expect(result).toMatchObject({
      total: 2,
      upserted: 1,
      skipped: 0,
      dropped: 1,
      runId: "run-1",
    });
  });

  it("records dropped as scanned minus kept", async () => {
    const result = await runIngest("openstates:ca", async () => ({
      kept: [keptRow],
      scanned: 400,
    }));

    expect(upsertInstruments).toHaveBeenCalledWith([keptRow]);
    expect(update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({ status: "SUCCESS", dropped: 399 }),
    });
    expect(result).toMatchObject({ total: 400, dropped: 399 });
  });

  it("records FAILED with an error class and rethrows", async () => {
    upsertInstruments.mockRejectedValue(new Error("P2002 unique"));

    await expect(
      runIngest("congress.gov", async () => filterCandidates([keptRow]))
    ).rejects.toThrow(/P2002/);

    expect(update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorClass: "DatabaseError",
      }),
    });
  });

  it("records a fetch failure without upserting", async () => {
    await expect(
      runIngest("congress.gov", async () => {
        throw new Error("OPEN_STATES_API_KEY is not set");
      })
    ).rejects.toThrow(/OPEN_STATES_API_KEY/);

    expect(upsertInstruments).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorClass: "MissingApiKey",
      }),
    });
  });
});

describe("getLastSuccessfulRunAt", () => {
  it("returns the start of the newest finished SUCCESS run for the source", async () => {
    const startedAt = new Date("2026-11-11T12:00:00Z");
    findFirst.mockResolvedValue({ startedAt });

    await expect(getLastSuccessfulRunAt("openstates:ca")).resolves.toBe(startedAt);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        source: "openstates:ca",
        status: "SUCCESS",
        finishedAt: { not: null },
      },
      orderBy: { finishedAt: "desc" },
      select: { startedAt: true },
    });
  });

  it("returns null when the source has never succeeded", async () => {
    findFirst.mockResolvedValue(null);
    await expect(getLastSuccessfulRunAt("congress.gov:119")).resolves.toBeNull();
  });
});
