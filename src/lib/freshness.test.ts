import { describe, expect, it } from "vitest";
import { STALE_AFTER_DAYS, summarizeFreshness } from "./freshness";
import type { PublicFreshness } from "./queries";

const EMPTY: PublicFreshness = {
  lastSuccessfulRunAt: null,
  lastSuccessfulSource: null,
  lastFailedRunAt: null,
  lastFailedErrorClass: null,
  oldestLastCheckedAt: null,
  newestLastCheckedAt: null,
};

const NOW = new Date("2026-11-25T12:00:00.000Z");

describe("summarizeFreshness", () => {
  it("reports no data when no run or check exists", () => {
    const summary = summarizeFreshness(EMPTY, NOW);
    expect(summary.state).toBe("no-data");
    expect(summary.headline).toBe("No ingest run has been recorded yet.");
    expect(summary.warnings).toEqual([]);
    expect(summary.ageDays).toBeNull();
  });

  it("names the adapter instead of showing its slug", () => {
    const summary = summarizeFreshness(
      {
        ...EMPTY,
        lastSuccessfulRunAt: "2026-11-24T09:30:00.000Z",
        lastSuccessfulSource: "legiscan",
        oldestLastCheckedAt: "2026-11-20T09:30:00.000Z",
        newestLastCheckedAt: "2026-11-24T09:30:00.000Z",
      },
      NOW
    );

    expect(summary.state).toBe("fresh");
    expect(summary.headline).toContain("(LegiScan)");
    expect(summary.headline).toContain("11/24/2026");
    expect(summary.detail).toContain("Instrument checks range from");
    expect(summary.warnings).toEqual([]);
    expect(summary.ageDays).toBe(1);
  });

  it("falls back to instrument check timestamps for fixture-only databases", () => {
    const summary = summarizeFreshness(
      { ...EMPTY, newestLastCheckedAt: "2026-11-20T12:00:00.000Z" },
      NOW
    );

    expect(summary.state).toBe("fresh");
    expect(summary.headline).toContain("Data last checked");
    expect(summary.ageDays).toBe(5);
  });

  it("marks data stale past the threshold", () => {
    const summary = summarizeFreshness(
      { ...EMPTY, newestLastCheckedAt: "2026-11-01T12:00:00.000Z" },
      NOW
    );

    expect(summary.state).toBe("stale");
    expect(summary.ageDays).toBeGreaterThan(STALE_AFTER_DAYS);
    expect(summary.warnings[0]).toContain("days old");
  });

  it("warns when the newest attempt failed", () => {
    const summary = summarizeFreshness(
      {
        ...EMPTY,
        lastSuccessfulRunAt: "2026-11-20T12:00:00.000Z",
        lastSuccessfulSource: "openstates",
        lastFailedRunAt: "2026-11-24T12:00:00.000Z",
        lastFailedErrorClass: "UpstreamTimeout",
        newestLastCheckedAt: "2026-11-20T12:00:00.000Z",
      },
      NOW
    );

    expect(summary.state).toBe("failed");
    expect(summary.warnings[0]).toContain("UpstreamTimeout");
    expect(summary.warnings[0]).toContain("11/24/2026");
  });

  it("does not warn about a failure older than the last success", () => {
    const summary = summarizeFreshness(
      {
        ...EMPTY,
        lastSuccessfulRunAt: "2026-11-24T12:00:00.000Z",
        lastSuccessfulSource: "congress",
        lastFailedRunAt: "2026-11-20T12:00:00.000Z",
        lastFailedErrorClass: "UpstreamError",
        newestLastCheckedAt: "2026-11-24T12:00:00.000Z",
      },
      NOW
    );

    expect(summary.state).toBe("fresh");
    expect(summary.warnings).toEqual([]);
  });

  it("ignores unparseable timestamps", () => {
    const summary = summarizeFreshness(
      {
        ...EMPTY,
        lastSuccessfulRunAt: "not-a-date",
        newestLastCheckedAt: "also-not-a-date",
      },
      NOW
    );
    expect(summary.state).toBe("no-data");
  });
});
