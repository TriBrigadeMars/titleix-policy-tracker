// Pure helpers to save/restore window bounds safely across restarts.
// No fs or Electron imports — file IO happens in main.ts (WP-06).

import {
  DESKTOP_DEFAULT_HEIGHT,
  DESKTOP_DEFAULT_WIDTH,
} from "./constants";

export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

export interface DisplayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_DIMENSION = 100;
const MAX_DIMENSION = 20000;
const VISIBLE_THRESHOLD_PX = 50;

/**
 * Sanitize raw JSON read from disk (may be corrupt/missing/wrong shape).
 * Returns null for null/empty input, invalid JSON, non-object, or
 * missing/absurd dimensions (width or height < 100 or > 20000, non-numbers).
 */
export function parseSavedBounds(
  raw: string | null | undefined
): WindowBounds | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const width = obj.width;
  const height = obj.height;

  if (typeof width !== "number" || typeof height !== "number") {
    return null;
  }

  if (
    width < MIN_DIMENSION ||
    width > MAX_DIMENSION ||
    height < MIN_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    return null;
  }

  const result: WindowBounds = {
    width,
    height,
    maximized: Boolean(obj.maximized),
  };

  if (typeof obj.x === "number") {
    result.x = obj.x;
  }
  if (typeof obj.y === "number") {
    result.y = obj.y;
  }

  return result;
}

/**
 * Compute the visible (intersection) area of `bounds` within a single display.
 * Returns 0 when there is no overlap.
 */
function visibleArea(bounds: WindowBounds, display: DisplayArea): number {
  const bx = bounds.x ?? 0;
  const by = bounds.y ?? 0;

  const left = Math.max(bx, display.x);
  const top = Math.max(by, display.y);
  const right = Math.min(bx + bounds.width, display.x + display.width);
  const bottom = Math.min(by + bounds.height, display.y + display.height);

  const w = right - left;
  const h = bottom - top;

  if (w <= 0 || h <= 0) {
    return 0;
  }

  return w * h;
}

/**
 * True if at least ~50px of the bounds are visible on one of the given displays.
 * When x/y are unspecified the window is centered by Electron, so it is
 * considered visible.
 */
export function isBoundsVisibleOnAnyDisplay(
  bounds: WindowBounds,
  displays: DisplayArea[]
): boolean {
  if (bounds.x === undefined || bounds.y === undefined) {
    return true;
  }

  for (const display of displays) {
    if (visibleArea(bounds, display) >= VISIBLE_THRESHOLD_PX) {
      return true;
    }
  }

  return false;
}

/**
 * Merge saved state with defaults: use saved bounds only if parseable AND
 * visible on an available display; otherwise return defaults.
 */
export function resolveInitialBounds(
  savedRaw: string | null | undefined,
  displays: DisplayArea[]
): WindowBounds {
  const saved = parseSavedBounds(savedRaw);

  if (saved && isBoundsVisibleOnAnyDisplay(saved, displays)) {
    return saved;
  }

  return {
    width: DESKTOP_DEFAULT_WIDTH,
    height: DESKTOP_DEFAULT_HEIGHT,
    maximized: true,
  };
}
