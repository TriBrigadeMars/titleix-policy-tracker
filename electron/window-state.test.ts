import { describe, expect, it } from "vitest";
import {
  DESKTOP_DEFAULT_HEIGHT,
  DESKTOP_DEFAULT_WIDTH,
} from "./constants";
import {
  isBoundsVisibleOnAnyDisplay,
  parseSavedBounds,
  resolveInitialBounds,
  type DisplayArea,
  type WindowBounds,
} from "./window-state";

const singleDisplay: DisplayArea[] = [
  { x: 0, y: 0, width: 1920, height: 1080 },
];

describe("parseSavedBounds", () => {
  it.each([
    [null],
    [undefined],
    [""],
    ["   "],
  ])("returns null for empty input: %p", (input) => {
    expect(parseSavedBounds(input)).toBeNull();
  });

  it.each([
    ["{not valid json"],
    ["{width: 1400}"],
    ["undefined"],
    ["null"],
  ])("returns null for invalid JSON: %p", (input) => {
    expect(parseSavedBounds(input)).toBeNull();
  });

  it.each([
    ["{}"],
    ["[]"],
    ["\"string\""],
    ["42"],
    ["true"],
  ])("returns null for non-object JSON: %p", (input) => {
    expect(parseSavedBounds(input)).toBeNull();
  });

  it.each([
    ['{"width": "lots", "height": 900}'],
    ['{"width": 1400, "height": "tall"}'],
    ['{"width": null, "height": 900}'],
    ['{"width": 1400, "height": undefined}'],
  ])("returns null for non-number dimensions: %p", (input) => {
    expect(parseSavedBounds(input)).toBeNull();
  });

  it.each([
    ['{"width": 99, "height": 900}'],
    ['{"width": 1400, "height": 99}'],
    ['{"width": 0, "height": 900}'],
    ['{"width": 1400, "height": 0}'],
    ['{"width": 20001, "height": 900}'],
    ['{"width": 1400, "height": 20001}'],
    ['{"width": -100, "height": 900}'],
    ['{"width": 1400, "height": -100}'],
  ])("returns null for absurd dimensions: %p", (input) => {
    expect(parseSavedBounds(input)).toBeNull();
  });

  it("parses valid JSON with all fields", () => {
    const result = parseSavedBounds(
      '{"width": 1400, "height": 900, "x": 100, "y": 50, "maximized": true}'
    );
    expect(result).toEqual({
      width: 1400,
      height: 900,
      x: 100,
      y: 50,
      maximized: true,
    });
  });

  it("parses valid JSON without x/y (optional)", () => {
    const result = parseSavedBounds(
      '{"width": 1400, "height": 900, "maximized": false}'
    );
    expect(result).toEqual({
      width: 1400,
      height: 900,
      maximized: false,
    });
    expect(result?.x).toBeUndefined();
    expect(result?.y).toBeUndefined();
  });

  it("coerces non-boolean maximized to boolean", () => {
    const result = parseSavedBounds(
      '{"width": 1400, "height": 900, "maximized": "yes"}'
    );
    expect(result?.maximized).toBe(true);
  });

  it("treats missing maximized as false", () => {
    const result = parseSavedBounds('{"width": 1400, "height": 900}');
    expect(result?.maximized).toBe(false);
  });

  it("ignores non-number x/y values", () => {
    const result = parseSavedBounds(
      '{"width": 1400, "height": 900, "x": "bad", "y": null}'
    );
    expect(result).toEqual({
      width: 1400,
      height: 900,
      maximized: false,
    });
    expect(result?.x).toBeUndefined();
    expect(result?.y).toBeUndefined();
  });
});

describe("isBoundsVisibleOnAnyDisplay", () => {
  it("returns true when x/y are unspecified (window is centered by Electron)", () => {
    const bounds: WindowBounds = { width: 1400, height: 900, maximized: true };
    expect(isBoundsVisibleOnAnyDisplay(bounds, singleDisplay)).toBe(true);
  });

  it("returns true when bounds are fully inside a display", () => {
    const bounds: WindowBounds = {
      width: 800,
      height: 600,
      x: 100,
      y: 100,
      maximized: false,
    };
    expect(isBoundsVisibleOnAnyDisplay(bounds, singleDisplay)).toBe(true);
  });

  it("returns false when bounds overlap no display (off-screen)", () => {
    const bounds: WindowBounds = {
      width: 800,
      height: 600,
      x: 5000,
      y: 5000,
      maximized: false,
    };
    expect(isBoundsVisibleOnAnyDisplay(bounds, singleDisplay)).toBe(false);
  });

  it("returns true when bounds partially overlap a display by >= 50px", () => {
    // 100px wide strip visible on the right edge of the display
    const bounds: WindowBounds = {
      width: 800,
      height: 600,
      x: 1870,
      y: 100,
      maximized: false,
    };
    expect(isBoundsVisibleOnAnyDisplay(bounds, singleDisplay)).toBe(true);
  });

  it("returns false when visible area is < 50px²", () => {
    // Only 1px × 1px = 1px² visible (corner barely touching)
    const bounds: WindowBounds = {
      width: 800,
      height: 600,
      x: 1919,
      y: 1079,
      maximized: false,
    };
    expect(isBoundsVisibleOnAnyDisplay(bounds, singleDisplay)).toBe(false);
  });

  it("returns true when bounds are visible on any one of multiple displays", () => {
    const displays: DisplayArea[] = [
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 1920, y: 0, width: 1920, height: 1080 },
    ];
    const bounds: WindowBounds = {
      width: 800,
      height: 600,
      x: 2000,
      y: 100,
      maximized: false,
    };
    expect(isBoundsVisibleOnAnyDisplay(bounds, displays)).toBe(true);
  });

  it("returns false when bounds overlap no display across multiple displays", () => {
    const displays: DisplayArea[] = [
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 1920, y: 0, width: 1920, height: 1080 },
    ];
    const bounds: WindowBounds = {
      width: 800,
      height: 600,
      x: 5000,
      y: 5000,
      maximized: false,
    };
    expect(isBoundsVisibleOnAnyDisplay(bounds, displays)).toBe(false);
  });
});

describe("resolveInitialBounds", () => {
  it("uses saved bounds when parseable and visible", () => {
    const saved = JSON.stringify({
      width: 1280,
      height: 800,
      x: 50,
      y: 50,
      maximized: false,
    });
    const result = resolveInitialBounds(saved, singleDisplay);
    expect(result).toEqual({
      width: 1280,
      height: 800,
      x: 50,
      y: 50,
      maximized: false,
    });
  });

  it("falls back to defaults when saved bounds are off-screen", () => {
    const saved = JSON.stringify({
      width: 1280,
      height: 800,
      x: 5000,
      y: 5000,
      maximized: false,
    });
    const result = resolveInitialBounds(saved, singleDisplay);
    expect(result).toEqual({
      width: DESKTOP_DEFAULT_WIDTH,
      height: DESKTOP_DEFAULT_HEIGHT,
      maximized: true,
    });
  });

  it("falls back to defaults when saved JSON is corrupt", () => {
    const result = resolveInitialBounds("{broken", singleDisplay);
    expect(result).toEqual({
      width: DESKTOP_DEFAULT_WIDTH,
      height: DESKTOP_DEFAULT_HEIGHT,
      maximized: true,
    });
  });

  it("falls back to defaults when saved dimensions are absurd", () => {
    const saved = JSON.stringify({
      width: 50,
      height: 50,
      x: 0,
      y: 0,
      maximized: false,
    });
    const result = resolveInitialBounds(saved, singleDisplay);
    expect(result).toEqual({
      width: DESKTOP_DEFAULT_WIDTH,
      height: DESKTOP_DEFAULT_HEIGHT,
      maximized: true,
    });
  });

  it("falls back to defaults when saved is null", () => {
    const result = resolveInitialBounds(null, singleDisplay);
    expect(result).toEqual({
      width: DESKTOP_DEFAULT_WIDTH,
      height: DESKTOP_DEFAULT_HEIGHT,
      maximized: true,
    });
  });

  it("falls back to defaults when saved is empty string", () => {
    const result = resolveInitialBounds("", singleDisplay);
    expect(result).toEqual({
      width: DESKTOP_DEFAULT_WIDTH,
      height: DESKTOP_DEFAULT_HEIGHT,
      maximized: true,
    });
  });

  it("uses saved bounds without x/y (centered) when parseable", () => {
    const saved = JSON.stringify({
      width: 1280,
      height: 800,
      maximized: true,
    });
    const result = resolveInitialBounds(saved, singleDisplay);
    expect(result).toEqual({
      width: 1280,
      height: 800,
      maximized: true,
    });
  });
});
