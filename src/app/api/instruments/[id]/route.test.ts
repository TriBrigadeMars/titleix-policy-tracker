import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, update, deleteMany, createMany, transaction, auth } =
  vi.hoisted(() => ({
    findUnique: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
    transaction: vi.fn(),
    auth: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    instrument: { findUnique, update },
    instrumentIssueTag: { deleteMany, createMany },
    $transaction: transaction,
  },
}));

vi.mock("@/lib/auth", () => ({ auth }));

import { PATCH } from "./route";

const EDITOR = {
  id: "editor-1",
  role: "EDITOR",
  name: "Ed",
  email: "ed@example.com",
  image: null,
};

const READER = {
  id: "reader-1",
  role: "READER",
  name: "Rea",
  email: "rea@example.com",
  image: null,
};

const mockInstrument = {
  id: "inst-1",
  jurisdictionId: "jur-1",
  type: "BILL",
  identifier: "HB 100",
  title: "A bill",
  status: "PROPOSED",
  triageStatus: "RELEVANT",
  introducedAt: null,
  passedAt: null,
  effectiveAt: null,
  sourceUrl: null,
  rawSummary: null,
  isTitleIXRelevant: true,
  relevanceConfidence: 90,
  jurisdiction: {
    id: "jur-1",
    code: "US",
    name: "United States",
    level: "FEDERAL",
  },
  issueTags: [
    {
      issueTag: {
        id: "tag-1",
        slug: "athletics",
        label: "Athletics",
        sortOrder: 1,
        description: null,
      },
    },
  ],
  notes: [],
};

function signIn(user: unknown) {
  auth.mockResolvedValue(user === null ? null : { user });
}

function patch(id: string, body: unknown) {
  return new Request(`http://localhost/api/instruments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(mockInstrument);
  update.mockResolvedValue(mockInstrument);
  deleteMany.mockResolvedValue({ count: 1 });
  createMany.mockResolvedValue({ count: 1 });
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
    return cb({
      instrument: { findUnique, update },
      instrumentIssueTag: { deleteMany, createMany },
    });
  });
});

describe("PATCH /api/instruments/[id]", () => {
  const validBody = {
    isTitleIXRelevant: true,
    relevanceConfidence: 90,
    issueTagIds: ["tag-1"],
  };

  it("rejects unauthenticated requests with 401", async () => {
    signIn(null);
    const res = await PATCH(patch("inst-1", validBody), {
      params: Promise.resolve({ id: "inst-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects readers with 403", async () => {
    signIn(READER);
    const res = await PATCH(patch("inst-1", validBody), {
      params: Promise.resolve({ id: "inst-1" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects malformed JSON with 400", async () => {
    signIn(EDITOR);
    const res = await PATCH(patch("inst-1", "{malformed"), {
      params: Promise.resolve({ id: "inst-1" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  it("rejects invalid body schema with 400", async () => {
    signIn(EDITOR);
    const res = await PATCH(
      patch("inst-1", { ...validBody, relevanceConfidence: 150 }),
      { params: Promise.resolve({ id: "inst-1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("rejects extra fields with 400", async () => {
    signIn(EDITOR);
    const res = await PATCH(
      patch("inst-1", { ...validBody, rogueField: "attempt" }),
      { params: Promise.resolve({ id: "inst-1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when instrument does not exist", async () => {
    signIn(EDITOR);
    findUnique.mockResolvedValue(null);
    const res = await PATCH(patch("missing", validBody), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("handles Prisma P2003 foreign key violation", async () => {
    signIn(EDITOR);
    transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("FK failed", {
        code: "P2003",
        clientVersion: "6.0.0",
      })
    );
    const res = await PATCH(patch("inst-1", validBody), {
      params: Promise.resolve({ id: "inst-1" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown issue tag");
  });

  it("updates triage and returns instrument on success", async () => {
    signIn(EDITOR);
    const res = await PATCH(patch("inst-1", validBody), {
      params: Promise.resolve({ id: "inst-1" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("inst-1");
    expect(deleteMany).toHaveBeenCalledWith({ where: { instrumentId: "inst-1" } });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ instrumentId: "inst-1", issueTagId: "tag-1" }],
    });
  });

  it("updates with triageStatus: NOT_RELEVANT and deduplicates issue tag IDs", async () => {
    signIn(EDITOR);
    const res = await PATCH(
      patch("inst-1", {
        triageStatus: "NOT_RELEVANT",
        relevanceConfidence: null,
        issueTagIds: ["tag-1", "tag-1"],
      }),
      { params: Promise.resolve({ id: "inst-1" }) }
    );
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          triageStatus: "NOT_RELEVANT",
          isTitleIXRelevant: false,
          relevanceConfidence: null,
        },
      })
    );
    expect(createMany).toHaveBeenCalledWith({
      data: [{ instrumentId: "inst-1", issueTagId: "tag-1" }],
    });
  });
});
