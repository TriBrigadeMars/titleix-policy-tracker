import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopPlatform, isDesktopApp } from "./is-desktop";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isDesktopApp", () => {
  it("returns false when window is undefined (SSR)", () => {
    expect(isDesktopApp()).toBe(false);
  });

  it("returns true when titleIXDesktop is exposed on window", () => {
    vi.stubGlobal("window", {
      titleIXDesktop: { platform: "win32", version: "1.0.0" },
    });
    expect(isDesktopApp()).toBe(true);
  });

  it("returns false in a browser without titleIXDesktop", () => {
    vi.stubGlobal("window", {});
    expect(isDesktopApp()).toBe(false);
  });
});

describe("desktopPlatform", () => {
  it("returns null when window is undefined (SSR)", () => {
    expect(desktopPlatform()).toBeNull();
  });

  it("returns the exposed platform inside the desktop shell", () => {
    vi.stubGlobal("window", {
      titleIXDesktop: { platform: "win32", version: "1.0.0" },
    });
    expect(desktopPlatform()).toBe("win32");
  });

  it("returns null in a browser without titleIXDesktop", () => {
    vi.stubGlobal("window", {});
    expect(desktopPlatform()).toBeNull();
  });
});