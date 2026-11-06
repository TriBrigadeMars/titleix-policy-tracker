import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

/**
 * Integration coverage for instrument-note POST/DELETE against a real Postgres,
 * mirroring cell-notes: authorId from the session, 401/403, and onDelete SetNull.
 */
const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);
const RUN_ID = `it-${Date.now().toString(36)}-${process.pid}`;

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth }));

import { DELETE, POST } from "./route";

const EDITOR = {
  id: `${RUN_ID}-editor`,
  role: "EDITOR",
  name: "Integration Editor",
  email: `${RUN_ID}-editor@example.com`,
  image: null,
};

const READER = {
  id: `${RUN_ID}-reader`,
  role: "READER",
  name: "Integration Reader",
  email: `${RUN_ID}-reader@example.com`,
  image: null,
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

function del(id: string) {
  return new Request(
    `http://localhost/api/instrument-notes?id=${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

describe.skipIf(!hasTestDatabase)("instrument-notes write path (Postgres)", () => {
  let jurisdictionId: string;
  let instrumentId: string;

  beforeAll(async () => {
    const jurisdiction = await prisma.jurisdiction.create({
      data: {
        code: RUN_ID,
        name: "Instrument Note Jurisdiction",
        level: "STATE",
      },
    });
    jurisdictionId = jurisdiction.id;

    const instrument = await prisma.instrument.create({
      data: {
        jurisdictionId,
        type: "BILL",
        identifier: `${RUN_ID}-bill`,
        title: "Title IX note integration bill",
        status: "PROPOSED",
        triageStatus: "UNREVIEWED",
      },
    });
    instrumentId = instrument.id;

    await prisma.user.createMany({
      data: [EDITOR, READER].map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as "EDITOR" | "READER",
      })),
    });
  });

  afterAll(async () => {
    await prisma.instrumentNote.deleteMany({ where: { instrumentId } });
    await prisma.instrument.deleteMany({ where: { id: instrumentId } });
    await prisma.jurisdiction.deleteMany({ where: { id: jurisdictionId } });
    await prisma.user.deleteMany({
      where: { email: { in: [EDITOR.email, READER.email] } },
    });
    await prisma.$disconnect();
  });

  it("rejects unauthenticated POST with 401", async () => {
    signIn(null);
    const response = await POST(
      post({ instrumentId, body: "Should not write" })
    );
    expect(response.status).toBe(401);
    expect(await prisma.instrumentNote.count({ where: { instrumentId } })).toBe(
      0
    );
  });

  it("rejects a READER POST with 403", async () => {
    signIn(READER);
    const response = await POST(
      post({ instrumentId, body: "Reader note" })
    );
    expect(response.status).toBe(403);
    expect(await prisma.instrumentNote.count({ where: { instrumentId } })).toBe(
      0
    );
  });

  it("creates a note crediting the session user, ignoring a body authorId", async () => {
    signIn(EDITOR);
    const response = await POST(
      post({
        instrumentId,
        body: "First instrument note",
        authorId: "ignored",
      })
    );
    expect(response.status).toBe(400);

    const created = await POST(
      post({ instrumentId, body: "First instrument note" })
    );
    expect(created.status).toBe(201);
    const payload = await created.json();
    expect(payload.authorId).toBe(EDITOR.id);
    expect(payload.author).toEqual({ id: EDITOR.id, name: EDITOR.name });

    const stored = await prisma.instrumentNote.findUnique({
      where: { id: payload.id },
    });
    expect(stored).toMatchObject({
      instrumentId,
      body: "First instrument note",
      authorId: EDITOR.id,
    });
  });

  it("deletes the note, then reports the second delete as 404", async () => {
    signIn(EDITOR);
    const created = await POST(post({ instrumentId, body: "Doomed note" }));
    const payload = await created.json();

    const first = await DELETE(del(payload.id));
    expect(first.status).toBe(204);
    expect(
      await prisma.instrumentNote.findUnique({ where: { id: payload.id } })
    ).toBeNull();

    const second = await DELETE(del(payload.id));
    expect(second.status).toBe(404);
  });

  it("keeps the note when the author user is removed", async () => {
    signIn(EDITOR);
    const created = await POST(
      post({ instrumentId, body: "Survives author deletion" })
    );
    const payload = await created.json();

    await prisma.user.delete({ where: { id: EDITOR.id } });

    const stored = await prisma.instrumentNote.findUnique({
      where: { id: payload.id },
    });
    expect(stored).toMatchObject({
      id: payload.id,
      body: "Survives author deletion",
      authorId: null,
    });
  });
});
