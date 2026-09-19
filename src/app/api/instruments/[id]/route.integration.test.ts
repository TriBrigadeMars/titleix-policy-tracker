import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { upsertInstruments, type RawInstrument } from "@/lib/ingest";

/**
 * Integration coverage for the instrument triage PATCH against a real Postgres.
 *
 * `route.test.ts` mocks the Prisma client, so it can only assert the arguments
 * the route *would* pass. It cannot prove that the tag sync is actually visible
 * through the relation table, that an unknown issue tag surfaces as a P2003
 * from the real foreign key, or — the point of the write path — that a later
 * re-ingest leaves the editor's triage decision and lifecycle status intact.
 * Those are database semantics, so they are checked here.
 *
 * Gated on TEST_DATABASE_URL so `npm test` still passes without a database;
 * when it is set the vitest config points DATABASE_URL at the same database, so
 * `@/lib/db` hands back a real client. Only `auth` is mocked, matching the unit
 * tests: the session is the input under test, not something to stand in for.
 *
 * Every row written here carries RUN_ID in its code, slug, identifier or email,
 * so cleanup deletes exactly what this run created and nothing else.
 */
const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);
const RUN_ID = `it-${Date.now().toString(36)}-${process.pid}`;

const id = (suffix: string) => `${RUN_ID}-${suffix}`;

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth }));

import { PATCH } from "./route";

const EDITOR = {
  id: id("editor"),
  role: "EDITOR",
  name: "Integration Editor",
  email: `${RUN_ID}-editor@example.com`,
  image: null,
};

function signIn(user: unknown) {
  auth.mockResolvedValue(user === null ? null : { user });
}

function patch(instrumentId: string, body: unknown) {
  return new Request(`http://localhost/api/instruments/${instrumentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function context(instrumentId: string) {
  return { params: Promise.resolve({ id: instrumentId }) };
}

function rawRow(
  overrides: Partial<RawInstrument> &
    Pick<RawInstrument, "jurisdictionCode" | "identifier">
): RawInstrument {
  return {
    type: "BILL",
    title: "Untitled instrument",
    status: "PROPOSED",
    introducedAt: null,
    passedAt: null,
    effectiveAt: null,
    sourceUrl: null,
    rawSummary: null,
    ...overrides,
  };
}

describe.skipIf(!hasTestDatabase)("PATCH /api/instruments/[id] (Postgres)", () => {
  let jurisdictionCode: string;
  let jurisdictionId: string;
  let firstIssueTagId: string;
  let secondIssueTagId: string;
  let identifier: string;
  let instrumentId: string;

  function readInstrument() {
    return prisma.instrument.findUnique({
      where: { id: instrumentId },
      include: { issueTags: true },
    });
  }

  async function tagSlugs() {
    const stored = await readInstrument();
    return (stored?.issueTags ?? [])
      .map((link) => link.issueTagId)
      .sort();
  }

  beforeAll(async () => {
    jurisdictionCode = id("state");
    const jurisdiction = await prisma.jurisdiction.create({
      data: {
        code: jurisdictionCode,
        name: "Integration Triage State",
        level: "STATE",
      },
    });
    jurisdictionId = jurisdiction.id;

    const issueTags = await Promise.all(
      ["one", "two"].map((suffix) =>
        prisma.issueTag.create({
          data: {
            slug: id(`tag-${suffix}`),
            label: `Integration Tag ${suffix}`,
            sortOrder: 9998,
          },
        })
      )
    );
    firstIssueTagId = issueTags[0].id;
    secondIssueTagId = issueTags[1].id;

    await prisma.user.create({
      data: {
        id: EDITOR.id,
        email: EDITOR.email,
        name: EDITOR.name,
        role: "EDITOR",
      },
    });

    identifier = id("triage");
    const instrument = await prisma.instrument.create({
      data: {
        jurisdictionId,
        type: "BILL",
        identifier,
        title: "Original ingest title",
        status: "PROPOSED",
        triageStatus: "UNREVIEWED",
        isTitleIXRelevant: false,
      },
    });
    instrumentId = instrument.id;
  });

  afterAll(async () => {
    // Tag links and notes cascade with the instrument, but delete them
    // explicitly so a failure here cannot leave rows behind.
    await prisma.instrumentIssueTag.deleteMany({ where: { instrumentId } });
    await prisma.instrument.deleteMany({
      where: { identifier: { contains: RUN_ID } },
    });
    await prisma.issueTag.deleteMany({ where: { slug: { contains: RUN_ID } } });
    await prisma.jurisdiction.deleteMany({ where: { code: jurisdictionCode } });
    await prisma.user.deleteMany({ where: { email: EDITOR.email } });
    await prisma.$disconnect();
  });

  it("triage to RELEVANT writes status, derived relevance, tags and confidence", async () => {
    signIn(EDITOR);

    const response = await PATCH(
      patch(instrumentId, {
        triageStatus: "RELEVANT",
        issueTagIds: [firstIssueTagId, secondIssueTagId],
        relevanceConfidence: 85,
      }),
      context(instrumentId)
    );
    expect(response.status).toBe(200);

    const stored = await readInstrument();
    expect(stored).toMatchObject({
      triageStatus: "RELEVANT",
      isTitleIXRelevant: true,
      relevanceConfidence: 85,
    });
    expect(await tagSlugs()).toEqual([firstIssueTagId, secondIssueTagId].sort());

    // The response is the serialized instrument, so it has to agree with the
    // row rather than with the request body.
    const payload = await response.json();
    expect(payload).toMatchObject({
      id: instrumentId,
      triageStatus: "RELEVANT",
      isTitleIXRelevant: true,
      relevanceConfidence: 85,
    });
    expect(
      payload.issueTags.map(
        (link: { issueTag: { id: string } }) => link.issueTag.id
      ).sort()
    ).toEqual([firstIssueTagId, secondIssueTagId].sort());
  });

  it("legacy isTitleIXRelevant: false encodes as NOT_RELEVANT", async () => {
    signIn(EDITOR);

    const response = await PATCH(
      patch(instrumentId, { isTitleIXRelevant: false, issueTagIds: [] }),
      context(instrumentId)
    );
    expect(response.status).toBe(200);

    const stored = await readInstrument();
    expect(stored).toMatchObject({
      triageStatus: "NOT_RELEVANT",
      isTitleIXRelevant: false,
      relevanceConfidence: null,
    });
    expect(stored?.issueTags).toHaveLength(0);
  });

  it("returns 404 for an unknown instrument id", async () => {
    signIn(EDITOR);

    const response = await PATCH(
      patch(id("missing-instrument"), {
        triageStatus: "RELEVANT",
        issueTagIds: [firstIssueTagId],
      }),
      context(id("missing-instrument"))
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Instrument not found",
    });
  });

  it("rejects an unknown issue tag id with 400 from the real foreign key", async () => {
    signIn(EDITOR);
    const unknownTagId = id("missing-issue-tag");

    const response = await PATCH(
      patch(instrumentId, {
        triageStatus: "RELEVANT",
        issueTagIds: [unknownTagId],
      }),
      context(instrumentId)
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown issue tag",
    });
    // The transaction rolls back, so the rejected tag is not linked and the
    // instrument's triage state is left as the previous test wrote it.
    expect(await tagSlugs()).not.toContain(unknownTagId);
    expect(
      await prisma.instrumentIssueTag.count({
        where: { issueTagId: unknownTagId },
      })
    ).toBe(0);
  });

  it("keeps editor triage and lifecycle status when ingest re-runs", async () => {
    signIn(EDITOR);

    const triaged = await PATCH(
      patch(instrumentId, {
        triageStatus: "RELEVANT",
        issueTagIds: [firstIssueTagId, secondIssueTagId],
        relevanceConfidence: 70,
      }),
      context(instrumentId)
    );
    expect(triaged.status).toBe(200);

    const result = await upsertInstruments([
      rawRow({
        jurisdictionCode,
        identifier,
        title: "Re-ingested title",
        status: "EFFECTIVE",
        effectiveAt: "2025-08-01",
        rawSummary: "Re-ingested summary.",
      }),
    ]);
    expect(result).toEqual({ total: 1, upserted: 1, skipped: 0 });

    const rows = await prisma.instrument.findMany({
      where: { jurisdictionId, type: "BILL", identifier },
    });
    expect(rows).toHaveLength(1);

    const stored = await readInstrument();
    expect(stored?.id).toBe(instrumentId);
    expect(stored).toMatchObject({
      // machine-owned fields follow the source
      title: "Re-ingested title",
      rawSummary: "Re-ingested summary.",
      // editor/lifecycle-owned fields survive the re-ingest
      status: "PROPOSED",
      triageStatus: "RELEVANT",
      isTitleIXRelevant: true,
      relevanceConfidence: 70,
    });
    expect(stored?.effectiveAt?.toISOString()).toBe(
      new Date("2025-08-01").toISOString()
    );
    expect(await tagSlugs()).toEqual([firstIssueTagId, secondIssueTagId].sort());
  });
});
