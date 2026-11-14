import { beforeEach, expect, it, vi } from "vitest";
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { instrument: { findMany } } }));
import { findSourceConflicts, LEGISCAN_ONLY_STATES } from "./source-policy";
beforeEach(() => { findMany.mockReset(); findMany.mockResolvedValue([]); });

it("queries the other source's bills in the normalized jurisdictions", async () => {
  findMany.mockResolvedValue([{ jurisdiction: { code: "CA" } }]);
  expect(await findSourceConflicts("legiscan", [" ca ", "CA"])).toEqual(["CA"]);
  expect(findMany).toHaveBeenCalledWith({
    where: { type: "BILL", source: "openstates", jurisdiction: { code: { in: ["CA"] } } },
    distinct: ["jurisdictionId"],
    select: { jurisdiction: { select: { code: true } } },
  });
});

it("reserves all six 10th Circuit states for LegiScan even on an empty database", async () => {
  expect(await findSourceConflicts("openstates", [...LEGISCAN_ONLY_STATES])).toEqual([...LEGISCAN_ONLY_STATES].sort());
  expect(await findSourceConflicts("legiscan", [...LEGISCAN_ONLY_STATES])).toEqual([]);
});

it("fails closed on database errors", async () => {
  findMany.mockRejectedValue(new Error("database unavailable"));
  await expect(findSourceConflicts("openstates", ["CA"])).rejects.toThrow("database unavailable");
});


it("recognizes OpenStates jurisdiction aliases so names cannot bypass ownership", async () => {
  expect(await findSourceConflicts("openstates", ["Colorado", "ocd-jurisdiction/country:us/state:wy/government"])).toEqual(["CO", "WY"]);
});
