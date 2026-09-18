import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, update, auth } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique, update },
  },
}));

vi.mock("@/lib/auth", () => ({ auth }));

import { PATCH } from "./route";

const ADMIN = {
  id: "admin-1",
  role: "ADMIN",
  name: "Admin Alice",
  email: "admin@example.com",
  image: null,
};

const EDITOR = {
  id: "editor-1",
  role: "EDITOR",
  name: "Ed Editor",
  email: "editor@example.com",
  image: null,
};

const READER = {
  id: "reader-1",
  role: "READER",
  name: "Rea Reader",
  email: "reader@example.com",
  image: null,
};

const mockTargetUser = {
  id: "target-user-1",
  email: "target@example.com",
  name: "Target User",
  image: null,
  role: "READER",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

function signIn(user: unknown) {
  auth.mockResolvedValue(user === null ? null : { user });
}

function patch(id: string, body: unknown) {
  return new Request(`http://localhost/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(mockTargetUser);
  update.mockResolvedValue({
    ...mockTargetUser,
    role: "EDITOR",
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  });
});

describe("PATCH /api/admin/users/[id]", () => {
  it("rejects unauthenticated requests with 401", async () => {
    signIn(null);
    const res = await PATCH(patch("target-user-1", { role: "EDITOR" }), {
      params: Promise.resolve({ id: "target-user-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects readers with 403", async () => {
    signIn(READER);
    const res = await PATCH(patch("target-user-1", { role: "EDITOR" }), {
      params: Promise.resolve({ id: "target-user-1" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects editors with 403", async () => {
    signIn(EDITOR);
    const res = await PATCH(patch("target-user-1", { role: "EDITOR" }), {
      params: Promise.resolve({ id: "target-user-1" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects invalid JSON with 400", async () => {
    signIn(ADMIN);
    const res = await PATCH(patch("target-user-1", "{invalid json"), {
      params: Promise.resolve({ id: "target-user-1" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid JSON body");
  });

  it("rejects unknown role with 400", async () => {
    signIn(ADMIN);
    const res = await PATCH(patch("target-user-1", { role: "SUPERADMIN" }), {
      params: Promise.resolve({ id: "target-user-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects extra fields with 400", async () => {
    signIn(ADMIN);
    const res = await PATCH(
      patch("target-user-1", { role: "EDITOR", extra: "illegal" }),
      { params: Promise.resolve({ id: "target-user-1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("prevents admin self-demotion with 400", async () => {
    signIn(ADMIN);
    const res = await PATCH(patch("admin-1", { role: "READER" }), {
      params: Promise.resolve({ id: "admin-1" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Admins cannot demote their own account");
    expect(update).not.toHaveBeenCalled();
  });

  it("allows admin to update own role if remaining ADMIN", async () => {
    signIn(ADMIN);
    findUnique.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      role: "ADMIN",
      name: "Admin",
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    update.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      role: "ADMIN",
      name: "Admin",
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await PATCH(patch("admin-1", { role: "ADMIN" }), {
      params: Promise.resolve({ id: "admin-1" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 when target user is not found", async () => {
    signIn(ADMIN);
    findUnique.mockResolvedValue(null);
    const res = await PATCH(patch("nonexistent", { role: "EDITOR" }), {
      params: Promise.resolve({ id: "nonexistent" }),
    });
    expect(res.status).toBe(404);
  });

  it("updates role and returns updated user on success", async () => {
    signIn(ADMIN);
    const res = await PATCH(patch("target-user-1", { role: "EDITOR" }), {
      params: Promise.resolve({ id: "target-user-1" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.role).toBe("EDITOR");
    expect(update).toHaveBeenCalledWith({
      where: { id: "target-user-1" },
      data: { role: "EDITOR" },
      select: expect.any(Object),
    });
  });
});
