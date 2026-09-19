import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, fetch, upsertInstruments } = vi.hoisted(() => ({
  auth: vi.fn(),
  fetch: vi.fn(),
  upsertInstruments: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/ingest/congress", () => ({
  congressAdapter: { name: "congress.gov", fetch },
}));
vi.mock("@/lib/ingest", () => ({ upsertInstruments }));

import { POST } from "./route";

const ADMIN = {
  id: "admin-1",
  role: "ADMIN",
  name: "Ad",
  email: "a@e.com",
  image: null,
};
const EDITOR = {
  id: "editor-1",
  role: "EDITOR",
  name: "Ed",
  email: "e@e.com",
  image: null,
};
const READER = {
  id: "reader-1",
  role: "READER",
  name: "Re",
  email: "r@e.com",
  image: null,
};

function signIn(user: unknown) {
  auth.mockResolvedValue(user === null ? null : { user });
}

function post(url: string) {
  return new Request(url, { method: "POST" });
}

const base = "http://localhost/api/ingest/congress";

beforeEach(() => {
  vi.clearAllMocks();
  fetch.mockResolvedValue([]);
  upsertInstruments.mockResolvedValue({ total: 0, upserted: 0, skipped: 0 });
});

describe("POST /api/ingest/congress — authorization", () => {
  it("returns 401 without a session and never fetches", async () => {
    signIn(null);
    const response = await POST(post(base));
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 403 for a READER and never fetches", async () => {
    signIn(READER);
    const response = await POST(post(base));
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 403 for an EDITOR and never fetches", async () => {
    signIn(EDITOR);
    const response = await POST(post(base));
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/ingest/congress — ADMIN", () => {
  it("calls the adapter and upsert, returns the result", async () => {
    signIn(ADMIN);
    fetch.mockResolvedValue([
      {
        jurisdictionCode: "US",
        type: "BILL",
        identifier: "HR-1-119",
        title: "A bill",
        status: "PROPOSED",
        introducedAt: null,
        passedAt: null,
        effectiveAt: null,
        sourceUrl: null,
        rawSummary: null,
      },
    ]);
    upsertInstruments.mockResolvedValue({ total: 1, upserted: 1, skipped: 0 });

    const response = await POST(post(`${base}?congress=119&limit=10`));
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith({ congress: 119, limit: 10 });
    expect(upsertInstruments).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body).toEqual({
      source: "congress.gov",
      total: 1,
      upserted: 1,
      skipped: 0,
      limit: 10,
    });
  });

  it("uses default congress and limit when params are absent", async () => {
    signIn(ADMIN);
    await POST(post(base));
    expect(fetch).toHaveBeenCalledWith({ congress: 119, limit: 50 });
  });

  it("clamps limit to the max of 100", async () => {
    signIn(ADMIN);
    await POST(post(`${base}?limit=9999`));
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 })
    );
  });

  it("returns a generic 502 without leaking the upstream error", async () => {
    signIn(ADMIN);
    fetch.mockRejectedValue(new Error("upstream down"));
    const response = await POST(post(base));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({
      error: "Ingest failed. Check server logs for details.",
    });
  });
});
