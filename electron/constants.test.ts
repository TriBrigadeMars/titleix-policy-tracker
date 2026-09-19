import { describe, expect, it } from "vitest";
import {
  APP_ID,
  APP_NAME,
  DESKTOP_DEFAULT_HEIGHT,
  DESKTOP_DEFAULT_WIDTH,
  DESKTOP_MIN_HEIGHT,
  DESKTOP_MIN_WIDTH,
  authAllowlistOrigins,
  resolveAppUrl,
  urlOrigin,
} from "./constants";

describe("app identity constants", () => {
  it("defines the app id and name", () => {
    expect(APP_ID).toBe("org.titleixpolicytracker.desktop");
    expect(APP_NAME).toBe("Title IX Policy Tracker");
  });

  it("defines desktop window dimensions", () => {
    expect(DESKTOP_MIN_WIDTH).toBe(1000);
    expect(DESKTOP_MIN_HEIGHT).toBe(700);
    expect(DESKTOP_DEFAULT_WIDTH).toBe(1400);
    expect(DESKTOP_DEFAULT_HEIGHT).toBe(900);
  });
});

describe("resolveAppUrl", () => {
  it("returns localhost in dev even when DESKTOP_APP_URL is set", () => {
    process.env.DESKTOP_APP_URL = "https://production.example.org";
    try {
      expect(resolveAppUrl(false)).toBe("http://localhost:3000");
    } finally {
      delete process.env.DESKTOP_APP_URL;
    }
  });

  it("returns a valid https DESKTOP_APP_URL when packaged", () => {
    process.env.DESKTOP_APP_URL = "https://titleix.example.org";
    try {
      expect(resolveAppUrl(true)).toBe("https://titleix.example.org");
    } finally {
      delete process.env.DESKTOP_APP_URL;
    }
  });

  it("throws when packaged and DESKTOP_APP_URL is missing", () => {
    delete process.env.DESKTOP_APP_URL;
    expect(() => resolveAppUrl(true)).toThrow(/DESKTOP_APP_URL/);
  });

  it.each([
    ["http://insecure.example.org"],
    ["ftp://files.example.org"],
    ["javascript:alert(1)"],
  ])("throws when packaged and DESKTOP_APP_URL is %s", (badUrl) => {
    process.env.DESKTOP_APP_URL = badUrl;
    try {
      expect(() => resolveAppUrl(true)).toThrow(/https/);
    } finally {
      delete process.env.DESKTOP_APP_URL;
    }
  });
});

describe("urlOrigin", () => {
  it("extracts the origin from an absolute https URL", () => {
    expect(urlOrigin("https://accounts.google.com/o/oauth2/v2/auth")).toBe(
      "https://accounts.google.com",
    );
  });

  it("normalizes a trailing slash", () => {
    expect(urlOrigin("https://example.com/")).toBe("https://example.com");
    expect(urlOrigin("https://example.com")).toBe("https://example.com");
  });

  it("returns null for non-http(s) or relative strings", () => {
    for (const bad of [
      "javascript:alert(1)",
      "file:///C:/x",
      "/relative/path",
      "not a url",
      "",
    ]) {
      expect(urlOrigin(bad)).toBeNull();
    }
  });
});

describe("authAllowlistOrigins", () => {
  it("contains the app origin and both Google origins and nothing else", () => {
    const appOrigin = "https://titleix.example.org";
    expect(authAllowlistOrigins(appOrigin)).toEqual([
      appOrigin,
      "https://accounts.google.com",
      "https://www.google.com",
    ]);
  });
});