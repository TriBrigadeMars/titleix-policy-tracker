import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, fetch, upsertInstruments } = vi.hoisted(() => ({
  auth: vi.fn(),
  fetch: vi.fn(),
  upsertInstruments: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/ingest/openstates", () => ({
  openStatesAdapter: { name: "openstates", fetch },
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

const base = "http://localhost/api/ingest/openstates";

beforeEach(() => {
  vi.clearAllMocks();
  fetch.mockResolvedValue([]);
  upsertInstruments.mockResolvedValue({ total: 0, upserted: 0, skipped: 0 });
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
    });
  });

  it("uses default jurisdiction and limit, without session", async () => {
    signIn(ADMIN);
    await POST(post(base));
    expect(fetch).toHaveBeenCalledWith({ jurisdiction: "nc", limit: 50 });
  });

  it("clamps limit to the max of 100", async () => {
    signIn(ADMIN);
    await POST(post(`${base}?limit=9999`));
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 })
    );
  });

  it("returns 502 when the adapter fetch fails", async () => {
    signIn(ADMIN);
    fetch.mockRejectedValue(new Error("upstream down"));
    const response = await POST(post(base));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream down" });
  });
});