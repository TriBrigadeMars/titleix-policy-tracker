import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsert, deleteMany, findMany, auth } = vi.hoisted(() => ({
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  findMany: vi.fn(),
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { cellNote: { upsert, deleteMany, findMany } },
}));

vi.mock("@/lib/auth", () => ({ auth }));

import { DELETE, GET, PUT } from "./route";

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
  jurisdictionId: "jur_1",
  issueTagId: "tag_1",
  body: "A note",
};

function signIn(user: unknown) {
  auth.mockResolvedValue(user === null ? null : { user });
}

function put(body: unknown) {
  return new Request("http://localhost/api/cell-notes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function del(id?: string) {
  const url = id
    ? `http://localhost/api/cell-notes?id=${encodeURIComponent(id)}`
    : "http://localhost/api/cell-notes";
  return new Request(url, { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ id: "note-1", ...validBody, authorId: EDITOR.id });
  deleteMany.mockResolvedValue({ count: 1 });
  findMany.mockResolvedValue([]);
});

function get(jurisdictionIds?: string) {
  const url = jurisdictionIds
    ? `http://localhost/api/cell-notes?jurisdictionIds=${encodeURIComponent(jurisdictionIds)}`
    : "http://localhost/api/cell-notes";
  return new Request(url);
}

describe("GET", () => {
  it("returns 401 without a session", async () => {
    signIn(null);
    const response = await GET(get("jur_1"));
    expect(response.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns 400 without jurisdictionIds", async () => {
    signIn(READER);
    const response = await GET(get());
    expect(response.status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("allows a READER to read a bounded list", async () => {
    signIn(READER);
    const response = await GET(get("jur_1,jur_2"));
    expect(response.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jurisdictionId: { in: ["jur_1", "jur_2"] } },
      })
    );
  });
});

describe("PUT authorization", () => {
  it("returns 401 without a session and never touches the database", async () => {
    signIn(null);
    const response = await PUT(put(validBody));
    expect(response.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns 403 for a READER and never touches the database", async () => {
    signIn(READER);
    const response = await PUT(put(validBody));
    expect(response.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("allows an EDITOR", async () => {
    signIn(EDITOR);
    const response = await PUT(put(validBody));
    expect(response.status).toBe(200);
  });
});

describe("PUT validation", () => {
  it("returns 400 for a malformed JSON body", async () => {
    signIn(EDITOR);
    const response = await PUT(put("{ not json"));
    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty note", async () => {
    signIn(EDITOR);
    const response = await PUT(put({ ...validBody, body: "   " }));
    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns 400 when the body tries to set the author", async () => {
    signIn(EDITOR);
    const response = await PUT(
      put({ ...validBody, authorId: "someone-else" })
    );
    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns 400 for an over-length note", async () => {
    signIn(EDITOR);
    const response = await PUT(
      put({ ...validBody, body: "x".repeat(10_001) })
    );
    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("PUT write", () => {
  it("upserts on the jurisdiction/issue-tag pair", async () => {
    signIn(EDITOR);
    await PUT(put(validBody));

    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      jurisdictionId_issueTagId: {
        jurisdictionId: "jur_1",
        issueTagId: "tag_1",
      },
    });
  });

  it("takes the author from the session, never the request", async () => {
    signIn(EDITOR);
    await PUT(put(validBody));

    const call = upsert.mock.calls[0][0];
    expect(call.create.authorId).toBe("editor-1");
  });

  it("does not reassign the author on update", async () => {
    signIn(EDITOR);
    await PUT(put(validBody));

    const call = upsert.mock.calls[0][0];
    expect(call.update).toEqual({ body: "A note" });
    expect(call.update).not.toHaveProperty("authorId");
  });

  it("stores the trimmed body", async () => {
    signIn(EDITOR);
    await PUT(put({ ...validBody, body: "  padded  " }));

    const call = upsert.mock.calls[0][0];
    expect(call.create.body).toBe("padded");
    expect(call.update).toEqual({ body: "padded" });
  });

  it("maps a foreign key violation to a 400", async () => {
    signIn(EDITOR);
    upsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("fk", {
        code: "P2003",
        clientVersion: "test",
      })
    );

    const response = await PUT(put(validBody));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown jurisdiction or issue tag",
    });
  });

  it("does not swallow unexpected errors", async () => {
    signIn(EDITOR);
    upsert.mockRejectedValue(new Error("connection reset"));

    await expect(PUT(put(validBody))).rejects.toThrow("connection reset");
  });
});

describe("DELETE", () => {
  it("returns 401 without a session", async () => {
    signIn(null);
    const response = await DELETE(del("note-1"));
    expect(response.status).toBe(401);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("returns 403 for a READER", async () => {
    signIn(READER);
    const response = await DELETE(del("note-1"));
    expect(response.status).toBe(403);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("returns 400 when no id is given", async () => {
    signIn(EDITOR);
    const response = await DELETE(del());
    expect(response.status).toBe(400);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the note is already gone", async () => {
    signIn(EDITOR);
    deleteMany.mockResolvedValue({ count: 0 });
    const response = await DELETE(del("note-1"));
    expect(response.status).toBe(404);
  });

  it("returns 204 on success", async () => {
    signIn(EDITOR);
    const response = await DELETE(del("note-1"));
    expect(response.status).toBe(204);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "note-1" } });
  });
});
