import { describe, expect, it } from "vitest";
import {
  classifyUrl,
  createAuthFlowGuard,
  isSafeExternalUrl,
  type UrlAction,
} from "./security";

const appOrigin = "https://titleix.example.org";
const authOrigins = ["https://accounts.google.com", "https://www.google.com"];

describe("classifyUrl", () => {
  describe("in-app navigation (ALLOW)", () => {
    it.each([
      ["https://titleix.example.org/heatmap", false],
      ["https://titleix.example.org/admin", false],
    ])("returns ALLOW for %s (authActive=%s)", (url, authActive) => {
      const result = classifyUrl(url, appOrigin, authOrigins, authActive);
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
      ["https://congress.gov/bill/...", false],
      ["https://legiscan.com/...", false],
      ["https://accounts.google.com/o/oauth2/v2/auth?...", false],
    ])("returns OPEN_EXTERNAL for %s (authActive=%s)", (url, authActive) => {
      const result = classifyUrl(url, appOrigin, authOrigins, authActive);
      expect(result).toEqual({ kind: "OPEN_EXTERNAL" });
    });
  });

  describe("blocked URLs (BLOCK)", () => {
    it.each([
      ["javascript:alert(1)", false],
      ["javascript:alert(1)", true],
      ["file:///C:/Windows/System32", false],
      ["file:///C:/Windows/System32", true],
      ["http://titleix.example.org", false],
      ["http://localhost:3000", false],
      ["https://evil.example.org", false],
      ["https://evil.example.org", true],
      ["", false],
      ["", true],
      ["/relative/path", false],
      ["not a url", false],
    ])("returns BLOCK for %s (authActive=%s)", (url, authActive) => {
      const result = classifyUrl(url, appOrigin, authOrigins, authActive);
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
    ["http://example.com", false],
    ["", false],
    ["/relative/path", false],
    ["not a url", false],
    ["data:text/html,<script>alert(1)</script>", false],
  ])("returns false for %s", (url) => {
    expect(isSafeExternalUrl(url)).toBe(false);
  });
});

describe("createAuthFlowGuard", () => {
  it("starts inactive", () => {
    const guard = createAuthFlowGuard();
    expect(guard.isActive()).toBe(false);
  });

  it("becomes active after begin()", () => {
    const guard = createAuthFlowGuard();
    guard.begin();
    expect(guard.isActive()).toBe(true);
  });

  it("becomes inactive after end()", () => {
    const guard = createAuthFlowGuard();
    guard.begin();
    guard.end();
    expect(guard.isActive()).toBe(false);
  });

  it("can be toggled multiple times", () => {
    const guard = createAuthFlowGuard();
    expect(guard.isActive()).toBe(false);
    guard.begin();
    expect(guard.isActive()).toBe(true);
    guard.end();
    expect(guard.isActive()).toBe(false);
    guard.begin();
    expect(guard.isActive()).toBe(true);
  });
});