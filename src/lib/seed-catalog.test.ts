import { afterAll, beforeAll, expect, it } from "vitest";
import { bootstrapLocalPGlite, type LocalDatabaseHandle } from "./local-runtime/pglite-bootstrap";
import { seedCatalogAndCorpus, seedCatalog } from "./seed-catalog";
import corpus from "../../prisma/fixtures/demo-corpus.json";
import type { DemoCorpus } from "./seed-catalog";

let handle: LocalDatabaseHandle;
beforeAll(async () => {
  handle = await bootstrapLocalPGlite({ inMemory: true, seedOnFirstRun: false });
}, 20_000);
afterAll(async () => { await handle?.close(); });

it("preserves existing instrument facts, editor triage, tags and cell notes on reseed", async () => {
  const db = handle.prisma;
  await seedCatalogAndCorpus(db, corpus as DemoCorpus);
  const row = corpus.instruments[0];
  const instrument = await db.instrument.findFirstOrThrow({ where: { identifier: row.identifier } });
  const replacementTag = await db.issueTag.findFirstOrThrow({ where: { slug: { notIn: row.issueTagSlugs } } });
  await db.instrument.update({ where: { id: instrument.id }, data: { title: "Updated source title", triageStatus: "NOT_RELEVANT", relevanceConfidence: 12 } });
  await db.instrumentIssueTag.deleteMany({ where: { instrumentId: instrument.id } });
  await db.instrumentIssueTag.create({ data: { instrumentId: instrument.id, issueTagId: replacementTag.id } });
  const note = await db.cellNote.findFirstOrThrow();
  await db.cellNote.update({ where: { id: note.id }, data: { body: "Editor correction" } });
  const counts = await Promise.all([db.instrument.count(), db.instrumentIssueTag.count(), db.cellNote.count()]);
  await seedCatalogAndCorpus(db, corpus as DemoCorpus);
  expect(await db.instrument.findUniqueOrThrow({ where: { id: instrument.id } })).toMatchObject({ title: "Updated source title", triageStatus: "NOT_RELEVANT", relevanceConfidence: 12 });
  expect(await db.instrumentIssueTag.findMany({ where: { instrumentId: instrument.id }, select: { issueTagId: true } })).toEqual([{ issueTagId: replacementTag.id }]);
  expect((await db.cellNote.findUniqueOrThrow({ where: { id: note.id } })).body).toBe("Editor correction");
  expect(await Promise.all([db.instrument.count(), db.instrumentIssueTag.count(), db.cellNote.count()])).toEqual(counts);
});

it("records only one fixture ingest run", async () => {
  await seedCatalogAndCorpus(handle.prisma, corpus as DemoCorpus);
  await seedCatalogAndCorpus(handle.prisma, corpus as DemoCorpus);
  expect(await handle.prisma.ingestRun.count({ where: { source: "fixture" } })).toBe(1);
});


it("seeds only the catalogue when requested", async () => {
  const fresh = await bootstrapLocalPGlite({ inMemory: true, seedOnFirstRun: false });
  try {
    await seedCatalog(fresh.prisma);
    await seedCatalog(fresh.prisma);
    expect(await fresh.prisma.jurisdiction.count()).toBe(52);
    expect(await fresh.prisma.issueTag.count()).toBe(8);
    expect(await fresh.prisma.instrument.count()).toBe(0);
    expect(await fresh.prisma.cellNote.count()).toBe(0);
    expect(await fresh.prisma.ingestRun.count()).toBe(0);
  } finally {
    await fresh.close();
  }
}, 20_000);
