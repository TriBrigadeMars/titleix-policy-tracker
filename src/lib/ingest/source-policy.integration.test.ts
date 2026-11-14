import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { findSourceConflicts } from "./source-policy";

const runId = `source-policy-${process.pid}-${Date.now()}`;
describe.skipIf(!process.env.TEST_DATABASE_URL)("state source ownership (Postgres)", () => {
  let jurisdictionId: string;
  let createdJurisdiction = false;
  beforeAll(async () => {
    const existing = await prisma.jurisdiction.findUnique({ where: { code: "CA" } });
    jurisdictionId = existing?.id ?? (await prisma.jurisdiction.create({ data: { code: "CA", name: "California", level: "STATE" } })).id;
    createdJurisdiction = !existing;
  });
  afterAll(async () => {
    await prisma.instrument.deleteMany({ where: { identifier: { startsWith: runId } } });
    if (createdJurisdiction) await prisma.jurisdiction.delete({ where: { id: jurisdictionId } });
    await prisma.$disconnect();
  });
  it("detects the opposite persisted source in both directions", async () => {
    const row = await prisma.instrument.create({ data: {
      jurisdictionId, identifier: `${runId}-AB1`, type: "BILL", status: "PROPOSED", title: "Test bill",
      source: "openstates", sourceId: runId,
    } });
    expect(await findSourceConflicts("legiscan", ["ca"])).toContain("CA");
    await prisma.instrument.update({ where: { id: row.id }, data: { source: "legiscan" } });
    expect(await findSourceConflicts("openstates", ["California"])).toContain("CA");
  });
});
