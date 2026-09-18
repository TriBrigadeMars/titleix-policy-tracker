import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, fetch, upsertInstruments } = vi.hoisted(() => ({
  auth: vi.fn(),
  fetch: vi.fn(),
  upsertInstruments: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/ingest/legiscan", () => ({
  legiScanAdapter: { name: "legiscan", fetch },
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

function signIn(user: unknown) {
  auth.mockResolvedValue(user === null ? null : { user });
}

function post(url: string) {
  return new Request(url, { method: "POST" });
}

const base = "http://localhost/api/ingest/legiscan";

beforeEach(() => {
  vi.clearAllMocks();
  fetch.mockResolvedValue([]);
  upsertInstruments.mockResolvedValue({ total: 0, upserted: 0, skipped: 0 });
});

describe("POST /api/ingest/legiscan — authorization", () => {
  it("returns 401 without a session and never fetches", async () => {
    signIn(null);
    expect((await POST(post(base))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 403 for a READER", async () => {
    signIn({ id: "r", role: "READER" });
    expect((await POST(post(base))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 403 for an EDITOR", async () => {
    signIn(EDITOR);
    expect((await POST(post(base))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/ingest/legiscan — ADMIN", () => {
  it("prefers the id param over state", async () => {
    signIn(ADMIN);
    await POST(post(`${base}?id=1541&state=ca`));
    expect(fetch).toHaveBeenCalledWith({ id: "1541" });
  });

  it("uses state when id is absent", async () => {
    signIn(ADMIN);
    await POST(post(`${base}?state=ca`));
    expect(fetch).toHaveBeenCalledWith({ state: "ca" });
  });

  it("calls the adapter with no params and returns the result", async () => {
    signIn(ADMIN);
    fetch.mockResolvedValue([
      {
        jurisdictionCode: "CA",
        type: "BILL",
        identifier: "CA-AB1",
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

    const response = await POST(post(base));
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith({});
    const body = await response.json();
    expect(body).toEqual({
      source: "legiscan",
      total: 1,
      upserted: 1,
      skipped: 0,
    });
  });

  it("returns 502 when the adapter fetch fails", async () => {
    signIn(ADMIN);
    fetch.mockRejectedValue(new Error("missing key"));
    const response = await POST(post(base));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "missing key" });
  });
});