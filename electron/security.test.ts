import { describe, expect, it } from "vitest";
import {
  classifyUrl,
  createAuthFlowGuard,
  isNetworkError,
  isSafeExternalUrl,
} from "./security";

const appOrigin = "https://titleix.example.org";
const authOrigins = ["https://accounts.google.com", "https://www.google.com"];

describe("classifyUrl", () => {
  describe("in-app navigation (ALLOW)", () => {
    it.each([
      ["https://titleix.example.org/heatmap", appOrigin, false],
      ["https://titleix.example.org/admin", appOrigin, false],
      ["app://tracker/", "app://tracker", false],
      ["app://tracker/heatmap", "app://tracker", false],
      ["app://tracker/triage?relevance=unreviewed", "app://tracker", false],
    ])("returns ALLOW for %s (origin=%s)", (url, origin, authActive) => {
      const result = classifyUrl(url, origin, authOrigins, authActive);
      expect(result).toEqual({ kind: "ALLOW" });
    });
  });

  describe("auth flow (ALLOW when active)", () => {
    it("returns ALLOW for auth origin when authActive is true", () => {
      const result = classifyUrl(
        "https://accounts.google.com/o/oauth2/v2/auth?...",
        appOrigin,
        authOrigins,
        true
      );
      expect(result).toEqual({ kind: "ALLOW" });
    });
  });

  describe("external navigation (OPEN_EXTERNAL)", () => {
    it.each([
      ["https://congress.gov/bill/...", "app://tracker", false],
      ["https://legiscan.com/...", "app://tracker", false],
      ["https://accounts.google.com/o/oauth2/v2/auth?...", appOrigin, false],
      ["https://evil.example.org", appOrigin, false],
      ["https://evil.example.org", appOrigin, true],
    ])("returns OPEN_EXTERNAL for %s", (url, origin, authActive) => {
      const result = classifyUrl(url, origin, authOrigins, authActive);
      expect(result).toEqual({ kind: "OPEN_EXTERNAL" });
    });
  });

  describe("blocked URLs (BLOCK)", () => {
    it.each([
      ["javascript:alert(1)", "app://tracker", false],
      ["file:///etc/passwd", "app://tracker", false],
      ["app://other-host/admin", "app://tracker", false],
      ["app://tracker/admin", appOrigin, false],
      ["http://titleix.example.org", appOrigin, false],
      ["http://localhost:3000", "app://tracker", false],
      ["", "app://tracker", false],
      ["/relative/path", "app://tracker", false],
      ["not a url", "app://tracker", false],
    ])("returns BLOCK for %s (origin=%s)", (url, origin, authActive) => {
      const result = classifyUrl(url, origin, authOrigins, authActive);
      expect(result).toEqual({ kind: "BLOCK" });
    });
  });
});

describe("isSafeExternalUrl", () => {
  it.each([
    ["https://example.com/a?b=1", true],
    ["https://example.com", true],
    ["https://sub.example.com/path", true],
  ])("returns true for %s", (url, expected) => {
    expect(isSafeExternalUrl(url)).toBe(expected);
  });

  it.each([
    ["javascript:alert(1)", false],
    ["file:///C:/x", false],
    ["app://tracker/admin", false],
    ["http://example.com", false],
    ["", false],
    ["/relative/path", false],
    ["not a url", false],
    ["data:text/html,<script>alert(1)</script>", false],
  ])("returns false for %s", (url, expected) => {
    expect(isSafeExternalUrl(url)).toBe(expected);
  });
});

describe("createAuthFlowGuard", () => {
  it("toggles active state cleanly", () => {
    const guard = createAuthFlowGuard();
    expect(guard.isActive()).toBe(false);
    guard.begin();
    expect(guard.isActive()).toBe(true);
    guard.end();
    expect(guard.isActive()).toBe(false);
  });
});

describe("isNetworkError", () => {
  it.each([
    [-100, true],
    [-102, true],
    [-106, true],
    ["-106", true],
    [-20, false],
    [0, false],
    [404, false],
    [500, false],
    ["not-a-number", false],
    [Number.NaN, false],
  ])("classifies %s -> %s", (code, expected) => {
    expect(isNetworkError(code)).toBe(expected);
  });
});