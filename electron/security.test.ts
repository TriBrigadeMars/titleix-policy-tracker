import { describe, expect, it } from "vitest";
import {
  classifyUrl,
  createAuthFlowGuard,
  isNetworkError,
  isSafeExternalUrl,
  secureWebPreferences,
  windowOpenDecision,
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
describe("windowOpenDecision", () => {
  const localOrigin = "app://tracker";

  it.each([
    ["app://tracker/?j=US,CA", localOrigin, false],
    ["app://tracker/triage", localOrigin, false],
    ["https://titleix.example.org/?j=US,CA", appOrigin, false],
  ])("returns allow for %s (origin=%s)", (url, origin, authActive) => {
    expect(windowOpenDecision(url, origin, authOrigins, authActive)).toBe(
      "allow"
    );
  });

  it("returns allow for an auth origin only while the auth flow is active", () => {
    const url = "https://accounts.google.com/o/oauth2/v2/auth?x=1";
    expect(windowOpenDecision(url, appOrigin, authOrigins, true)).toBe("allow");
    expect(windowOpenDecision(url, appOrigin, authOrigins, false)).toBe(
      "external"
    );
  });

  it.each([
    ["https://www.congress.gov/bill/118th-congress/house-bill/1", localOrigin],
    ["https://legiscan.com/WY/bill/HB0001/2025", localOrigin],
    ["https://evil.example.org/", appOrigin],
  ])("returns external for %s", (url, origin) => {
    expect(windowOpenDecision(url, origin, authOrigins, false)).toBe(
      "external"
    );
  });

  it.each([
    ["http://www.congress.gov/", localOrigin],
    ["http://titleix.example.org/", appOrigin],
    ["file:///etc/passwd", localOrigin],
    ["javascript:alert(1)", localOrigin],
    ["data:text/html,<script>alert(1)</script>", localOrigin],
    ["app://other/", localOrigin],
    ["app://tracker/", appOrigin],
    ["about:blank", localOrigin],
    ["", localOrigin],
    ["not a url", localOrigin],
  ])("returns deny for %s (origin=%s)", (url, origin) => {
    expect(windowOpenDecision(url, origin, authOrigins, false)).toBe("deny");
    expect(windowOpenDecision(url, origin, authOrigins, true)).toBe("deny");
  });
});

describe("secureWebPreferences", () => {
  it("locks down every window and keeps the preload", () => {
    expect(
      secureWebPreferences("/app/preload.js", ["--titleix-version=1.2.3"])
    ).toEqual({
      preload: "/app/preload.js",
      additionalArguments: ["--titleix-version=1.2.3"],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    });
  });

  it("does not share the arguments array between windows", () => {
    const args = ["--a"];
    const prefs = secureWebPreferences("/p.js", args);
    args.push("--b");
    expect(prefs.additionalArguments).toEqual(["--a"]);
  });
});
