import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { upsertInstruments, type RawInstrument } from "@/lib/ingest";
import { mapCongressBills } from "@/lib/ingest/congress";

/**
 * Integration coverage for {@link upsertInstruments} against a real Postgres,
 * including the migration-applied schema and the compound unique key. The unit
 * tests in `index.test.ts` mock the client and therefore cannot verify upsert
 * semantics, enum handling, or transaction rollback.
 *
 * Gated on TEST_DATABASE_URL so `npm test` still passes on a machine without a
 * database; CI sets it to the Postgres service container. When it is set the
 * vitest config points DATABASE_URL at the same database, so the module under
 * test uses the real singleton client.
 *
 * Every row written here carries RUN_ID in its identifier or jurisdiction code,
 * so cleanup deletes exactly what this run created and nothing else.
 */
const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);
const RUN_ID = `it-${Date.now().toString(36)}-${process.pid}`;

const id = (suffix: string) => `${RUN_ID}-${suffix}`;

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

describe.skipIf(!hasTestDatabase)("upsertInstruments (Postgres)", () => {
  let fedCode: string;
  let stateCode: string;
  let fedId: string;
  let stateId: string;
  let usId: string;

  const createdJurisdictionIds: string[] = [];

  async function ensureJurisdiction(
    code: string,
    name: string,
    level: "FEDERAL" | "STATE"
  ): Promise<string> {
    const existing = await prisma.jurisdiction.findUnique({ where: { code } });
    if (existing) return existing.id;
    const created = await prisma.jurisdiction.create({
      data: { code, name, level },
    });
    createdJurisdictionIds.push(created.id);
    return created.id;
  }

  function findByKey(
    jurisdictionId: string,
    type: RawInstrument["type"],
    identifier: string
  ) {
    return prisma.instrument.findUnique({
      where: {
        jurisdictionId_type_identifier: { jurisdictionId, type, identifier },
      },
    });
  }

  beforeAll(async () => {
    fedCode = id("fed");
    stateCode = id("state");
    fedId = await ensureJurisdiction(fedCode, "Integration Federal", "FEDERAL");
    stateId = await ensureJurisdiction(stateCode, "Integration State", "STATE");
    // The Congress.gov mapper hardcodes jurisdiction code "US"; reuse the
    // seeded row when a developer has run `db:seed`, otherwise create one and
    // let cleanup remove it.
    usId = await ensureJurisdiction("US", "United States", "FEDERAL");
  });

  afterAll(async () => {
    await prisma.instrument.deleteMany({
      where: { identifier: { contains: RUN_ID } },
    });
    if (createdJurisdictionIds.length > 0) {
      await prisma.jurisdiction.deleteMany({
        where: { id: { in: createdJurisdictionIds } },
      });
    }
    await prisma.$disconnect();
  });

  it("creates an instrument on first sight with machine fields and untriaged defaults", async () => {
    const identifier = id("create");
    const result = await upsertInstruments([
      rawRow({
        jurisdictionCode: fedCode,
        identifier,
        title: "Campus SaVE Reauthorization",
        status: "PROPOSED",
        introducedAt: "2025-01-15",
        sourceUrl: "https://example.gov/instruments/create",
        rawSummary: "Introduced and referred to committee.",
      }),
    ]);

    expect(result).toEqual({ total: 1, upserted: 1, skipped: 0 });

    const stored = await findByKey(fedId, "BILL", identifier);
    expect(stored).not.toBeNull();
    expect(stored).toMatchObject({
      jurisdictionId: fedId,
      type: "BILL",
      identifier,
      title: "Campus SaVE Reauthorization",
      status: "PROPOSED",
      passedAt: null,
      effectiveAt: null,
      sourceUrl: "https://example.gov/instruments/create",
      rawSummary: "Introduced and referred to committee.",
      isTitleIXRelevant: false,
      relevanceConfidence: null,
    });
    expect(stored?.introducedAt?.toISOString()).toBe(
      new Date("2025-01-15").toISOString()
    );
    expect(stored?.lastCheckedAt).toBeInstanceOf(Date);
  });

  it("updates machine fields in place on re-ingest instead of inserting a duplicate", async () => {
    const identifier = id("update");
    await upsertInstruments([
      rawRow({
        jurisdictionCode: fedCode,
        identifier,
        title: "Original title",
        status: "PROPOSED",
        introducedAt: "2025-02-01",
        sourceUrl: "https://example.gov/instruments/update",
        rawSummary: "Original summary.",
      }),
    ]);
    const created = await findByKey(fedId, "BILL", identifier);

    const result = await upsertInstruments([
      rawRow({
        jurisdictionCode: fedCode,
        identifier,
        title: "Amended title",
        status: "PASSED",
        introducedAt: "2025-02-01",
        passedAt: "2025-06-01",
        sourceUrl: "https://example.gov/instruments/update/v2",
        rawSummary: "Amended summary.",
      }),
    ]);

    expect(result).toEqual({ total: 1, upserted: 1, skipped: 0 });

    const rows = await prisma.instrument.findMany({
      where: { jurisdictionId: fedId, identifier },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created?.id);
    expect(rows[0]).toMatchObject({
      title: "Amended title",
      status: "PROPOSED",
      sourceUrl: "https://example.gov/instruments/update/v2",
      rawSummary: "Amended summary.",
    });
    expect(rows[0].passedAt?.toISOString()).toBe(
      new Date("2025-06-01").toISOString()
    );
  });

  it("preserves editor-owned triage fields when re-ingesting", async () => {
    const identifier = id("triage");
    await upsertInstruments([
      rawRow({ jurisdictionCode: fedCode, identifier, title: "First pass" }),
    ]);
    const created = await findByKey(fedId, "BILL", identifier);
    expect(created).not.toBeNull();

    await prisma.instrument.update({
      where: { id: created!.id },
      data: {
        triageStatus: "RELEVANT",
        isTitleIXRelevant: true,
        relevanceConfidence: 85,
      },
    });

    await upsertInstruments([
      rawRow({
        jurisdictionCode: fedCode,
        identifier,
        title: "Re-ingested title",
        status: "EFFECTIVE",
        effectiveAt: "2025-08-01",
      }),
    ]);

    const stored = await findByKey(fedId, "BILL", identifier);
    expect(stored).toMatchObject({
      title: "Re-ingested title",
      status: "PROPOSED",
      triageStatus: "RELEVANT",
      isTitleIXRelevant: true,
      relevanceConfidence: 85,
    });
  });

  it("skips rows with an unknown jurisdiction code and ingests the rest", async () => {
    const knownIdentifier = id("known");
    const unknownIdentifier = id("unknown");

    const result = await upsertInstruments([
      rawRow({ jurisdictionCode: fedCode, identifier: knownIdentifier }),
      rawRow({
        jurisdictionCode: id("does-not-exist"),
        identifier: unknownIdentifier,
      }),
    ]);

    expect(result).toEqual({ total: 2, upserted: 1, skipped: 1 });
    expect(await findByKey(fedId, "BILL", knownIdentifier)).not.toBeNull();
    expect(
      await prisma.instrument.count({ where: { identifier: unknownIdentifier } })
    ).toBe(0);
  });

  it("handles an all-unknown batch and an empty batch without error", async () => {
    const result = await upsertInstruments([
      rawRow({
        jurisdictionCode: id("still-missing"),
        identifier: id("nothing"),
      }),
    ]);

    expect(result).toEqual({ total: 1, upserted: 0, skipped: 1 });
    expect(
      await prisma.instrument.count({ where: { identifier: id("nothing") } })
    ).toBe(0);

    expect(await upsertInstruments([])).toEqual({
      total: 0,
      upserted: 0,
      skipped: 0,
    });
  });

  it("treats (jurisdiction, type, identifier) as the instrument identity", async () => {
    const shared = id("shared");
    const result = await upsertInstruments([
      rawRow({ jurisdictionCode: fedCode, identifier: shared, type: "BILL" }),
      rawRow({ jurisdictionCode: fedCode, identifier: shared, type: "STATUTE" }),
      rawRow({ jurisdictionCode: stateCode, identifier: shared, type: "BILL" }),
    ]);

    expect(result).toEqual({ total: 3, upserted: 3, skipped: 0 });
    expect(
      await prisma.instrument.count({ where: { identifier: shared } })
    ).toBe(3);
    expect(await findByKey(stateId, "BILL", shared)).not.toBeNull();
    expect(await findByKey(fedId, "REGULATION", shared)).toBeNull();
  });

  it("rolls back the failing chunk and rethrows when the database rejects one row", async () => {
    const good = rawRow({ jurisdictionCode: fedCode, identifier: id("atomic") });
    // Over Postgres's btree index entry limit for
    // instruments_jurisdiction_id_type_identifier_key, so this row is rejected
    // by the database rather than by client-side validation. Random bytes are
    // used because Postgres TOAST compresses a repeated character away, which
    // would slip back under the limit.
    const oversized = rawRow({
      jurisdictionCode: fedCode,
      identifier: `${RUN_ID}-${randomBytes(3000).toString("hex")}`,
    });

    await expect(upsertInstruments([good, oversized])).rejects.toThrow();

    // Both rows land in the same chunk, so the chunk's transaction rolls back
    // and neither row is committed. (Chunks commit independently: rows in an
    // earlier chunk would stay committed, which is why ingest retries are safe
    // but not all-or-nothing.)
    expect(
      await prisma.instrument.count({ where: { identifier: good.identifier } })
    ).toBe(0);
    expect(
      await prisma.instrument.count({
        where: { identifier: oversized.identifier },
      })
    ).toBe(0);
  });

  it("stores Congress.gov mapper output end to end", async () => {
    const rows = mapCongressBills({
      bills: [
        {
          congress: 119,
          number: RUN_ID,
          type: "hr",
          title: "Title IX Accountability Act",
          introducedDate: "2025-03-04",
          latestAction: {
            actionDate: "2025-03-05",
            text: "Referred to the Committee on Education and the Workforce.",
          },
        },
      ],
    });
    expect(rows).toHaveLength(1);

    const result = await upsertInstruments(rows);
    expect(result).toEqual({ total: 1, upserted: 1, skipped: 0 });

    const stored = await prisma.instrument.findFirst({
      where: { identifier: rows[0].identifier },
    });
    expect(stored).toMatchObject({
      jurisdictionId: usId,
      type: "BILL",
      identifier: `hr-${RUN_ID}-119`,
      title: "Title IX Accountability Act",
      status: "PROPOSED",
      sourceUrl: `https://www.congress.gov/bill/119th-congress/house-bill/${RUN_ID}`,
      rawSummary: "Referred to the Committee on Education and the Workforce.",
      isTitleIXRelevant: false,
    });
    expect(stored?.introducedAt?.toISOString()).toBe(
      new Date("2025-03-04").toISOString()
    );
  });
});
