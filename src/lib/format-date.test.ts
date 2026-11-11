import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./format-date";

describe("formatDate and formatDateTime (SSR hydration safety)", () => {
  it("formats ISO strings and Date instances deterministically in UTC", () => {
    expect(formatDate("2026-11-01T00:00:00.000Z")).toBe("11/1/2026");
    expect(formatDate(new Date("2026-11-12T02:30:00.000Z"))).toBe("11/12/2026");
    expect(formatDateTime("2026-11-01T12:00:00.000Z")).toBe(
      "11/1/2026, 12:00:00 PM UTC"
    );
    expect(formatDateTime("2026-11-01T00:05:09.000Z")).toBe(
      "11/1/2026, 12:05:09 AM UTC"
    );
    expect(formatDateTime("2026-11-01T23:59:59.000Z")).toBe(
      "11/1/2026, 11:59:59 PM UTC"
    );
  });

  it("returns empty string for invalid date inputs", () => {
    expect(formatDate("not-a-date")).toBe("");
    expect(formatDateTime("not-a-date")).toBe("");
    expect(formatDate(new Date(Number.NaN))).toBe("");
    expect(formatDateTime(new Date(Number.NaN))).toBe("");
  });
});
