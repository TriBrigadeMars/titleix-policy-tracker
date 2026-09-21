import { describe, expect, it } from "vitest";
import {
  classifyUrl,
  createAuthFlowGuard,
  isNetworkError,
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
      ["https://evil.example.org", false],
      ["https://evil.example.org", true],
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

describe("isNetworkError", () => {
  it.each([
    [-100, "ERR_CONNECTION_CLOSED"],
    [-101, "ERR_CONNECTION_RESET"],
    [-102, "ERR_CONNECTION_REFUSED"],
    [-104, "ERR_NOT_CONNECTED"],
    [-105, "ERR_NAME_NOT_RESOLVED"],
    [-106, "ERR_INTERNET_DISCONNECTED"],
    [-109, "ERR_ADDRESS_UNREACHABLE"],
    [-113, "ERR_NETWORK_UNREACHABLE"],
    [-118, "ERR_TIMED_OUT"],
    [-127, "ERR_NETWORK_CHANGED"],
  ])("returns true for %i (%s)", (code) => {
    expect(isNetworkError(code)).toBe(true);
  });

  it("accepts stringified codes", () => {
    expect(isNetworkError("-106")).toBe(true);
    expect(isNetworkError("-102")).toBe(true);
  });

  it.each([
    [-20, "ERR_ABORTED (user cancel)"],
    [-21, "ERR_FAILED"],
    [-2, "ERR_FAILED (legacy)"],
    [-3, "ERR_ABORTED (legacy)"],
    [0, "no error"],
    [200, "HTTP 200"],
    [404, "HTTP 404"],
    [500, "HTTP 500"],
  ])("returns false for %i (%s)", (code) => {
    expect(isNetworkError(code)).toBe(false);
  });

  it.each(["", "not-a-number", "ERR_INTERNET_DISCONNECTED"])(
    "returns false for unparseable string %s",
    (value) => {
      expect(isNetworkError(value)).toBe(false);
    },
  );

  it("returns false for NaN/Infinity-like inputs", () => {
    expect(isNetworkError(Number.NaN)).toBe(false);
    expect(isNetworkError("NaN")).toBe(false);
  });
});