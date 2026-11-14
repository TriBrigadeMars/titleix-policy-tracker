import { expect, it } from "vitest";
import { findProbableDuplicates, normalizeBillNumber } from "./probable-duplicates";
it("normalizes bill numbers while retaining the chamber", () => {
  expect(["AB 123", "AB123", "ab-123"].map(normalizeBillNumber)).toEqual(["AB123", "AB123", "AB123"]);
  expect(normalizeBillNumber("SB 123")).not.toBe(normalizeBillNumber("AB 123"));
});
it("reports cross-source pairs in one jurisdiction without modifying its input", () => {
  const rows = [
    { id: "1", jurisdictionId: "ca", identifier: "CA-20252026-AB 123", source: "openstates" },
    { id: "2", jurisdictionId: "ca", identifier: "CA-s2172-ab123", source: "legiscan" },
    { id: "3", jurisdictionId: "ca", identifier: "CA-s2172-SB123", source: "legiscan" },
    { id: "4", jurisdictionId: "tx", identifier: "TX-s1-AB123", source: "legiscan" },
    { id: "5", jurisdictionId: "ca", identifier: "CA-s1-AB123", source: null },
  ];
  const before = structuredClone(rows);
  expect(findProbableDuplicates(rows)).toEqual([[rows[0], rows[1]]]);
  expect(rows).toEqual(before);
  expect(findProbableDuplicates([rows[0], { ...rows[1], source: "openstates" }])).toEqual([]);
});
