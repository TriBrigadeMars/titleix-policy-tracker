use serde::{Deserialize, Serialize};

use crate::constants::{DESKTOP_DEFAULT_HEIGHT, DESKTOP_DEFAULT_WIDTH};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WindowBounds {
    pub width: f64,
    pub height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct DisplayArea {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

const MIN_DIMENSION: f64 = 100.0;
const MAX_DIMENSION: f64 = 20000.0;
const VISIBLE_THRESHOLD_PX: f64 = 50.0;

pub fn parse_saved_bounds(raw: &str) -> Option<WindowBounds> {
    if raw.trim().is_empty() {
        return None;
    }
    let parsed: WindowBounds = serde_json::from_str(raw).ok()?;
    if !parsed.width.is_finite()
        || !parsed.height.is_finite()
        || parsed.width < MIN_DIMENSION
        || parsed.width > MAX_DIMENSION
        || parsed.height < MIN_DIMENSION
        || parsed.height > MAX_DIMENSION
    {
        return None;
    }
    Some(parsed)
}

fn visible_area(bounds: &WindowBounds, display: &DisplayArea) -> f64 {
    let bx = bounds.x.unwrap_or(0.0);
    let by = bounds.y.unwrap_or(0.0);
    let left = bx.max(display.x);
    let top = by.max(display.y);
    let right = (bx + bounds.width).min(display.x + display.width);
    let bottom = (by + bounds.height).min(display.y + display.height);
    let w = right - left;
    let h = bottom - top;
    if w <= 0.0 || h <= 0.0 {
        0.0
    } else {
        w * h
    }
}

pub fn is_bounds_visible_on_any_display(bounds: &WindowBounds, displays: &[DisplayArea]) -> bool {
    if bounds.x.is_none() || bounds.y.is_none() {
        return true;
    }
    displays
        .iter()
        .any(|d| visible_area(bounds, d) >= VISIBLE_THRESHOLD_PX)
}

pub fn resolve_initial_bounds(saved_raw: Option<&str>, displays: &[DisplayArea]) -> WindowBounds {
    if let Some(raw) = saved_raw {
        if let Some(saved) = parse_saved_bounds(raw) {
            if is_bounds_visible_on_any_display(&saved, displays) {
                return saved;
            }
        }
    }
    WindowBounds {
        width: DESKTOP_DEFAULT_WIDTH,
        height: DESKTOP_DEFAULT_HEIGHT,
        x: None,
        y: None,
        maximized: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_corrupt_or_offscreen_bounds_and_restores_valid_bounds() {
        let display = DisplayArea {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };
        assert!(parse_saved_bounds("not-json").is_none());
        assert!(parse_saved_bounds(r#"{"width":20,"height":800}"#).is_none());

        let valid = resolve_initial_bounds(
            Some(r#"{"width":1200,"height":800,"x":100,"y":100,"maximized":false}"#),
            &[display],
        );
        assert_eq!(valid.width, 1200.0);
        assert!(!valid.maximized);

        let offscreen = resolve_initial_bounds(
            Some(r#"{"width":1200,"height":800,"x":9000,"y":9000,"maximized":false}"#),
            &[display],
        );
        assert_eq!(offscreen.width, DESKTOP_DEFAULT_WIDTH);
        assert!(offscreen.maximized);
    }
}
