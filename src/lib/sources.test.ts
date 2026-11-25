import { describe, expect, it } from "vitest";
import { sourceLabel } from "./sources";

describe("sourceLabel", () => {
  it("maps known adapter slugs to public names", () => {
    expect(sourceLabel("legiscan")).toBe("LegiScan");
    expect(sourceLabel("openstates")).toBe("Open States");
    expect(sourceLabel("congress")).toBe("Congress.gov");
    expect(sourceLabel("fixture")).toBe("Demo fixture");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(sourceLabel("  LegiScan ")).toBe("LegiScan");
  });

  it("passes unknown sources through and returns null when absent", () => {
    expect(sourceLabel("manual")).toBe("manual");
    expect(sourceLabel(null)).toBeNull();
    expect(sourceLabel(undefined)).toBeNull();
    expect(sourceLabel("  ")).toBeNull();
  });
});
