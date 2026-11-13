import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, fetch, runIngest } = vi.hoisted(() => ({
  auth: vi.fn(),
  fetch: vi.fn(),
  runIngest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/ingest/openstates", () => ({
  openStatesAdapter: { name: "openstates", fetch },
}));
vi.mock("@/lib/ingest/pipeline", () => ({ runIngest }));

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

const base = "http://localhost/api/ingest/openstates";

beforeEach(() => {
  vi.clearAllMocks();
  fetch.mockResolvedValue([]);
  runIngest.mockImplementation(async (_source: string, fetchCandidates: () => Promise<{ kept: unknown[]; scanned: number }>) => {
    const { kept, scanned } = await fetchCandidates();
    return {
      total: scanned,
      upserted: kept.length,
      skipped: 0,
      dropped: scanned - kept.length,
      runId: "run-1",
    };
  });
});

describe("POST /api/ingest/openstates — authorization", () => {
  it("returns 401 without a session and never fetches", async () => {
    signIn(null);
    const response = await POST(post(base));
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 403 for a READER", async () => {
    signIn(READER);
    expect((await POST(post(base))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 403 for an EDITOR", async () => {
    signIn(EDITOR);
    expect((await POST(post(base))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/ingest/openstates — ADMIN", () => {
  it("calls the adapter and upsert, returns the result", async () => {
    signIn(ADMIN);
    fetch.mockResolvedValue([
      {
        jurisdictionCode: "NC",
        type: "BILL",
        identifier: "NC-2023-SB 113",
        title: "A Title IX bill",
        status: "PROPOSED",
        introducedAt: null,
        passedAt: null,
        effectiveAt: null,
        sourceUrl: null,
        rawSummary: null,
      },
    ]);
    const response = await POST(
      post(`${base}?jurisdiction=nc&session=2023&limit=10`)
    );
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith({ jurisdiction: "nc", session: "2023", limit: 10 });
    const body = await response.json();
    expect(body).toEqual({
      source: "openstates",
      total: 1,
      upserted: 1,
      skipped: 0,
      dropped: 0,
      runId: "run-1",
      limit: 10,
    });
  });

  it("requires an explicit jurisdiction instead of defaulting to nc", async () => {
    signIn(ADMIN);
    const response = await POST(post(base));
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the default limit, without session", async () => {
    signIn(ADMIN);
    await POST(post(`${base}?jurisdiction=nc`));
    expect(fetch).toHaveBeenCalledWith({ jurisdiction: "nc", limit: 50 });
  });

  it("clamps limit to the max of 100", async () => {
    signIn(ADMIN);
    await POST(post(`${base}?jurisdiction=nc&limit=9999`));
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 })
    );
  });

  it("returns a generic 502 without leaking the upstream error", async () => {
    signIn(ADMIN);
    runIngest.mockRejectedValue(new Error("upstream down"));
    const response = await POST(post(`${base}?jurisdiction=nc`));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Ingest failed. Check server logs for details.",
    });
  });
});