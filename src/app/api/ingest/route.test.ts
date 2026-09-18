import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth }));

vi.mock("@/lib/ingest/congress-gov", () => {
  const mockInstance = {
    fetch: vi.fn(),
  };
  return {
    CongressGovAdapter: vi.fn(function () {
      return mockInstance;
    }),
    __mockInstance: mockInstance,
  };
});

vi.mock("@/lib/ingest/upsert", () => ({
  upsertInstruments: vi.fn(),
}));

import { POST } from "./route";
import { upsertInstruments } from "@/lib/ingest/upsert";

const ADMIN = {
  id: "admin-1",
  role: "ADMIN",
  name: "Ad",
  email: "ad@example.com",
  image: null,
};

const READER = {
  id: "reader-1",
  role: "READER",
  name: "Rea",
  email: "rea@example.com",
  image: null,
};

function signIn(user: unknown) {
  auth.mockResolvedValue(user === null ? null : { user });
}

function post(url = "http://localhost/api/ingest") {
  return new Request(url, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CONGRESS_GOV_API_KEY", "test-key");
});

describe("POST authorization", () => {
  it("returns 401 without a session", async () => {
    signIn(null);
    const response = await POST(post());
    expect(response.status).toBe(401);
  });

  it("returns 403 for a READER", async () => {
    signIn(READER);
    const response = await POST(post());
    expect(response.status).toBe(403);
  });

  it("allows an ADMIN", async () => {
    signIn(ADMIN);
    const congressGovModule = await import("@/lib/ingest/congress-gov");
    const mockInstance = (
      congressGovModule as unknown as {
        __mockInstance: { fetch: { mockResolvedValue: (v: unknown) => void } };
      }
    ).__mockInstance;
    mockInstance.fetch.mockResolvedValue([
      {
        jurisdictionCode: "US",
        type: "BILL",
        identifier: "119-HR-1234",
        title: "Test",
        status: "PROPOSED",
        introducedAt: null,
        passedAt: null,
        effectiveAt: null,
        sourceUrl: null,
        rawSummary: null,
      },
    ]);
    vi.mocked(upsertInstruments).mockResolvedValue({
      created: 1,
      updated: 0,
      skipped: 0,
      total: 1,
    });

    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      created: 1,
      updated: 0,
      skipped: 0,
      total: 1,
    });
    expect(mockInstance.fetch).toHaveBeenCalled();
  });
});

describe("POST validation", () => {
  it("returns 500 when CONGRESS_GOV_API_KEY is missing", async () => {
    signIn(ADMIN);
    vi.stubEnv("CONGRESS_GOV_API_KEY", "");
    const response = await POST(post());
    expect(response.status).toBe(500);
  });

  it("returns 400 for a non-positive congress", async () => {
    signIn(ADMIN);
    const response = await POST(post("http://localhost/api/ingest?congress=0"));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a non-integer congress", async () => {
    signIn(ADMIN);
    const response = await POST(
      post("http://localhost/api/ingest?congress=abc")
    );
    expect(response.status).toBe(400);
  });
});
