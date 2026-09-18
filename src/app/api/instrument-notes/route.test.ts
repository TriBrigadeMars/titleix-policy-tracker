import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, deleteMany, auth } = vi.hoisted(() => ({
  create: vi.fn(),
  deleteMany: vi.fn(),
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    instrumentNote: { create, deleteMany },
  },
}));

vi.mock("@/lib/auth", () => ({ auth }));

import { DELETE, POST } from "./route";

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

const validBody = {
  instrumentId: "inst-1",
  body: "This bill addresses Title IX athletics regulations.",
};

const mockNote = {
  id: "note-1",
  instrumentId: "inst-1",
  authorId: "editor-1",
  body: validBody.body,
  createdAt: new Date("2026-09-18T10:00:00.000Z"),
  updatedAt: new Date("2026-09-18T10:00:00.000Z"),
  author: { id: "editor-1", name: "Ed" },
};

function signIn(user: unknown) {
  auth.mockResolvedValue(user === null ? null : { user });
}

function post(body: unknown) {
  return new Request("http://localhost/api/instrument-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function del(id?: string) {
  const url = id
    ? `http://localhost/api/instrument-notes?id=${encodeURIComponent(id)}`
    : "http://localhost/api/instrument-notes";
  return new Request(url, { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue(mockNote);
  deleteMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/instrument-notes", () => {
  it("rejects unauthenticated requests with 401", async () => {
    signIn(null);
    const res = await POST(post(validBody));
    expect(res.status).toBe(401);
  });

  it("rejects readers with 403", async () => {
    signIn(READER);
    const res = await POST(post(validBody));
    expect(res.status).toBe(403);
  });

  it("rejects malformed JSON with 400", async () => {
    signIn(EDITOR);
    const res = await POST(post("{bad-json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  it("rejects empty body with 400", async () => {
    signIn(EDITOR);
    const res = await POST(post({ ...validBody, body: "   " }));
    expect(res.status).toBe(400);
  });

  it("rejects extra fields like client-supplied authorId", async () => {
    signIn(EDITOR);
    const res = await POST(post({ ...validBody, authorId: "hacked" }));
    expect(res.status).toBe(400);
  });

  it("handles Prisma P2003 unknown instrument", async () => {
    signIn(EDITOR);
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("FK fail", {
        code: "P2003",
        clientVersion: "6.0.0",
      })
    );
    const res = await POST(post(validBody));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown instrument");
  });

  it("creates note and forces session authorId", async () => {
    signIn(EDITOR);
    const res = await POST(post(validBody));
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith({
      data: {
        instrumentId: "inst-1",
        body: validBody.body,
        authorId: EDITOR.id,
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });
    const data = await res.json();
    expect(data.id).toBe("note-1");
    expect(data.authorId).toBe(EDITOR.id);
  });
});

describe("DELETE /api/instrument-notes", () => {
  it("rejects unauthenticated requests with 401", async () => {
    signIn(null);
    const res = await DELETE(del("note-1"));
    expect(res.status).toBe(401);
  });

  it("rejects readers with 403", async () => {
    signIn(READER);
    const res = await DELETE(del("note-1"));
    expect(res.status).toBe(403);
  });

  it("rejects missing id with 400", async () => {
    signIn(EDITOR);
    const res = await DELETE(del());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing id");
  });

  it("returns 404 when note does not exist", async () => {
    signIn(EDITOR);
    deleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(del("missing"));
    expect(res.status).toBe(404);
  });

  it("deletes note and returns 204 on success", async () => {
    signIn(EDITOR);
    const res = await DELETE(del("note-1"));
    expect(res.status).toBe(204);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "note-1" } });
  });
});
