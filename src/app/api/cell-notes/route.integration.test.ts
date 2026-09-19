import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

/**
 * Integration coverage for the cell-note write path against a real Postgres.
 *
 * `route.test.ts` mocks the Prisma client, so it can only assert the arguments
 * the route *would* pass. It cannot prove that the compound unique key on
 * (jurisdiction, issue tag) makes the upsert an in-place replace, that the
 * foreign keys to `jurisdictions` and `issue_tags` are what turn an unknown id
 * into a P2003, or that `authorId` survives a second edit by a different
 * editor. Those are database semantics, so they are checked here.
 *
 * Gated on TEST_DATABASE_URL so `npm test` still passes without a database;
 * when it is set the vitest config points DATABASE_URL at the same database, so
 * `@/lib/db` hands back a real client. Only `auth` is mocked, matching the unit
 * tests: the session is the input under test, not something to stand in for.
 *
 * Every row written here carries RUN_ID in its code or email, so cleanup
 * deletes exactly what this run created and nothing else.
 */
const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);
const RUN_ID = `it-${Date.now().toString(36)}-${process.pid}`;

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth }));

import { DELETE, GET, PUT } from "./route";

const EDITOR = {
  id: `${RUN_ID}-editor`,
  role: "EDITOR",
  name: "Integration Editor",
  email: `${RUN_ID}-editor@example.com`,
  image: null,
};

const OTHER_EDITOR = {
  id: `${RUN_ID}-other-editor`,
  role: "EDITOR",
  name: "Second Integration Editor",
  email: `${RUN_ID}-other-editor@example.com`,
  image: null,
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

function del(id: string) {
  return new Request(
    `http://localhost/api/cell-notes?id=${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

function get(jurisdictionIds: string) {
  return new Request(
    `http://localhost/api/cell-notes?jurisdictionIds=${encodeURIComponent(
      jurisdictionIds
    )}`
  );
}

function findByCell(jurisdictionId: string, issueTagId: string) {
  return prisma.cellNote.findUnique({
    where: { jurisdictionId_issueTagId: { jurisdictionId, issueTagId } },
  });
}

describe.skipIf(!hasTestDatabase)("cell-notes write path (Postgres)", () => {
  let jurisdictionId: string;
  let otherJurisdictionId: string;
  let issueTagId: string;

  beforeAll(async () => {
    const jurisdiction = await prisma.jurisdiction.create({
      data: {
        code: RUN_ID,
        name: "Integration Jurisdiction",
        level: "STATE",
      },
    });
    jurisdictionId = jurisdiction.id;

    // A second, real jurisdiction is needed to prove that an unknown id is
    // rejected: the "unknown" case must be a well-formed cuid that is simply
    // absent, not a malformed string the route could reject on shape.
    const otherJurisdiction = await prisma.jurisdiction.create({
      data: {
        code: `${RUN_ID}-other`,
        name: "Integration Jurisdiction Two",
        level: "STATE",
      },
    });
    otherJurisdictionId = otherJurisdiction.id;

    const issueTag = await prisma.issueTag.create({
      data: {
        slug: RUN_ID,
        label: "Integration Issue Tag",
        sortOrder: 9999,
      },
    });
    issueTagId = issueTag.id;

    await prisma.user.createMany({
      data: [EDITOR, OTHER_EDITOR].map((editor) => ({
        id: editor.id,
        email: editor.email,
        name: editor.name,
        role: "EDITOR" as const,
      })),
    });
  });

  afterAll(async () => {
    // Cell notes cascade with their jurisdiction and issue tag, but delete them
    // explicitly so a failure here cannot leave notes behind.
    await prisma.cellNote.deleteMany({
      where: { jurisdictionId: { in: [jurisdictionId, otherJurisdictionId] } },
    });
    await prisma.issueTag.deleteMany({ where: { slug: RUN_ID } });
    await prisma.jurisdiction.deleteMany({
      where: { code: { in: [RUN_ID, `${RUN_ID}-other`] } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [EDITOR.email, OTHER_EDITOR.email] } },
    });
    await prisma.$disconnect();
  });

  it("creates a row on PUT, crediting the session user", async () => {
    signIn(EDITOR);

    const response = await PUT(
      put({ jurisdictionId, issueTagId, body: "First note" })
    );
    expect(response.status).toBe(200);

    const stored = await findByCell(jurisdictionId, issueTagId);
    expect(stored).toMatchObject({
      jurisdictionId,
      issueTagId,
      body: "First note",
      authorId: EDITOR.id,
    });

    const payload = await response.json();
    expect(payload).toMatchObject({
      id: stored?.id,
      body: "First note",
      authorId: EDITOR.id,
    });
    expect(payload.author).toEqual({ id: EDITOR.id, name: EDITOR.name });
  });

  it("replaces the body in place on a second PUT for the same cell", async () => {
    signIn(EDITOR);
    await PUT(put({ jurisdictionId, issueTagId, body: "Before edit" }));
    const created = await findByCell(jurisdictionId, issueTagId);

    signIn(OTHER_EDITOR);
    const response = await PUT(
      put({ jurisdictionId, issueTagId, body: "After edit" })
    );
    expect(response.status).toBe(200);

    const rows = await prisma.cellNote.findMany({
      where: { jurisdictionId, issueTagId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: created?.id,
      body: "After edit",
      authorId: EDITOR.id,
    });
    expect(rows[0].authorId).not.toBe(OTHER_EDITOR.id);
  });

  it("deletes the row, then reports the second delete as 404", async () => {
    signIn(EDITOR);
    await PUT(put({ jurisdictionId, issueTagId, body: "Doomed note" }));
    const created = await findByCell(jurisdictionId, issueTagId);
    expect(created).not.toBeNull();

    const first = await DELETE(del(created!.id));
    expect(first.status).toBe(204);
    expect(await findByCell(jurisdictionId, issueTagId)).toBeNull();

    const second = await DELETE(del(created!.id));
    expect(second.status).toBe(404);
  });

  it("rejects a note for an unknown jurisdiction", async () => {
    signIn(EDITOR);

    const response = await PUT(
      put({
        jurisdictionId: `${RUN_ID}-missing-jurisdiction`,
        issueTagId,
        body: "No such jurisdiction",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown jurisdiction or issue tag",
    });
    expect(
      await prisma.cellNote.count({
        where: { jurisdictionId: `${RUN_ID}-missing-jurisdiction` },
      })
    ).toBe(0);
  });

  it("rejects a note for an unknown issue tag", async () => {
    signIn(EDITOR);

    const response = await PUT(
      put({
        jurisdictionId,
        issueTagId: `${RUN_ID}-missing-issue-tag`,
        body: "No such issue tag",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown jurisdiction or issue tag",
    });
    expect(
      await prisma.cellNote.count({
        where: { issueTagId: `${RUN_ID}-missing-issue-tag` },
      })
    ).toBe(0);
  });

  it("reads the written note back through GET", async () => {
    signIn(EDITOR);
    await PUT(put({ jurisdictionId, issueTagId, body: "Readable note" }));

    const response = await GET(get(`${jurisdictionId},${otherJurisdictionId}`));
    expect(response.status).toBe(200);

    const notes = await response.json();
    const mine = notes.filter(
      (note: { jurisdictionId: string; issueTagId: string }) =>
        note.jurisdictionId === jurisdictionId && note.issueTagId === issueTagId
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      body: "Readable note",
      authorId: EDITOR.id,
    });
    expect(mine[0].author).toEqual({ id: EDITOR.id, name: EDITOR.name });
  });
});
