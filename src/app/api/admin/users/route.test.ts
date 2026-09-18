import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, auth } = vi.hoisted(() => ({
  findMany: vi.fn(),
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany },
  },
}));

vi.mock("@/lib/auth", () => ({ auth }));

import { GET } from "./route";

const ADMIN = {
  id: "admin-1",
  role: "ADMIN",
  name: "Admin Alice",
  email: "admin@example.com",
  image: null,
};

const READER = {
  id: "reader-1",
  role: "READER",
  name: "Rea Reader",
  email: "reader@example.com",
  image: null,
};

const EDITOR = {
  id: "editor-1",
  role: "EDITOR",
  name: "Ed Editor",
  email: "editor@example.com",
  image: null,
};

const mockUsers = [
  {
    id: "user-1",
    email: "user1@example.com",
    name: "User One",
    image: null,
    role: "ADMIN",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  },
  {
    id: "user-2",
    email: "user2@example.com",
    name: "User Two",
    image: null,
    role: "READER",
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
    updatedAt: new Date("2026-01-04T00:00:00.000Z"),
  },
];

function signIn(user: unknown) {
  auth.mockResolvedValue(user === null ? null : { user });
}

function get(query = "") {
  return new Request(`http://localhost/api/admin/users${query ? `?${query}` : ""}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue(mockUsers);
});

describe("GET /api/admin/users", () => {
  it("rejects unauthenticated requests with 401", async () => {
    signIn(null);
    const res = await GET(get());
    expect(res.status).toBe(401);
  });

  it("rejects readers with 403", async () => {
    signIn(READER);
    const res = await GET(get());
    expect(res.status).toBe(403);
  });

  it("rejects editors with 403", async () => {
    signIn(EDITOR);
    const res = await GET(get());
    expect(res.status).toBe(403);
  });

  it("returns user list for admin with default parameters", async () => {
    signIn(ADMIN);
    const res = await GET(get());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
      })
    );
  });

  it("passes search and role filters to query layer", async () => {
    signIn(ADMIN);
    const res = await GET(get("search=alice&role=ADMIN&limit=10"));
    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "ADMIN",
          OR: [
            { name: { contains: "alice", mode: "insensitive" } },
            { email: { contains: "alice", mode: "insensitive" } },
          ],
        }),
        take: 10,
      })
    );
  });
});
