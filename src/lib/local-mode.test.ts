import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalMode } from "./local-mode";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isLocalMode", () => {
  it('returns true only for exactly "1"', () => {
    expect(isLocalMode({ TITLEIX_LOCAL_MODE: "1" })).toBe(true);
  });

  it.each([undefined, "", "0", "true", "TRUE", "yes", " 1", "1 ", "01"])(
    "returns false for %j",
    (value) => {
      expect(isLocalMode({ TITLEIX_LOCAL_MODE: value })).toBe(false);
    }
  );

  it("reads process.env by default", () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "1");
    expect(isLocalMode()).toBe(true);
    vi.stubEnv("TITLEIX_LOCAL_MODE", "");
    expect(isLocalMode()).toBe(false);
  });
});
