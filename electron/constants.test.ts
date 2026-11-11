import { describe, expect, it } from "vitest";
import {
  APP_ID,
  APP_NAME,
  DESKTOP_DEFAULT_HEIGHT,
  DESKTOP_DEFAULT_WIDTH,
  DESKTOP_MIN_HEIGHT,
  DESKTOP_MIN_WIDTH,
  LOCAL_APP_URL,
  VERSION_ARG_PREFIX,
  authAllowlistOrigins,
  isLocalModeUrl,
  resolveAppUrl,
  resolvePreloadVersion,
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

describe("resolvePreloadVersion (Defect D3)", () => {
  it("extracts version from BrowserWindow additionalArguments when packaged", () => {
    expect(
      resolvePreloadVersion(
        ["electron", `${VERSION_ARG_PREFIX}1.2.3`],
        undefined
      )
    ).toBe("1.2.3");
  });

  it("falls back to npm_package_version in dev and 0.0.0 when both absent", () => {
    expect(resolvePreloadVersion(["electron"], "1.0.0")).toBe("1.0.0");
    expect(resolvePreloadVersion(["electron"], undefined)).toBe("0.0.0");
  });
});

describe("resolveAppUrl (Defect D2 + standalone local mode)", () => {
  it("returns localhost in dev even when DESKTOP_APP_URL is set", () => {
    expect(
      resolveAppUrl(false, {
        DESKTOP_APP_URL: "https://production.example.org",
      })
    ).toBe("http://localhost:3000");
  });

  it("returns app://tracker in dev when DESKTOP_MODE=local", () => {
    expect(resolveAppUrl(false, { DESKTOP_MODE: "local" })).toBe(LOCAL_APP_URL);
  });

  it("defaults packaged builds to standalone app://tracker when DESKTOP_APP_URL is unset", () => {
    expect(resolveAppUrl(true, {})).toBe("app://tracker");
    expect(isLocalModeUrl(resolveAppUrl(true, {}))).toBe(true);
  });

  it("returns a valid https DESKTOP_APP_URL when explicitly overriding packaged mode", () => {
    expect(
      resolveAppUrl(true, { DESKTOP_APP_URL: "https://titleix.example.org" })
    ).toBe("https://titleix.example.org");
    expect(isLocalModeUrl("https://titleix.example.org")).toBe(false);
  });

  it.each([
    ["http://insecure.example.org"],
    ["ftp://files.example.org"],
    ["javascript:alert(1)"],
  ])(
    "throws when packaged and explicit DESKTOP_APP_URL override is %s",
    (badUrl) => {
      expect(() =>
        resolveAppUrl(true, { DESKTOP_APP_URL: badUrl })
      ).toThrow(/https/);
    }
  );
});

describe("urlOrigin", () => {
  it("extracts the origin from an absolute https URL", () => {
    expect(urlOrigin("https://accounts.google.com/o/oauth2/v2/auth")).toBe(
      "https://accounts.google.com"
    );
  });

  it("normalizes app://tracker URLs to app://tracker and rejects foreign app:// hosts", () => {
    expect(urlOrigin("app://tracker/triage?status=PROPOSED")).toBe(
      "app://tracker"
    );
    expect(urlOrigin("app://tracker")).toBe("app://tracker");
    expect(urlOrigin("app://evil/triage")).toBeNull();
  });

  it("normalizes a trailing slash", () => {
    expect(urlOrigin("https://example.com/")).toBe("https://example.com");
    expect(urlOrigin("https://example.com")).toBe("https://example.com");
  });

  it("returns null for non-http(s)/non-app or relative strings", () => {
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