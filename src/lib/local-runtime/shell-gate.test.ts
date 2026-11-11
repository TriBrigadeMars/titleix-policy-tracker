import { describe, expect, it } from "vitest";
import { evaluateShellGate } from "../../../scripts/measure-shell-gate";

describe("Milestone 3 shell promotion gate (Electron -> Rust)", () => {
  it("passes when Rust AppImage meets size ratio, startup, and RSS thresholds", () => {
    const res = evaluateShellGate(
      {
        shell: "electron",
        artifactPath: "dist-desktop/app.AppImage",
        sizeBytes: 140_000_000,
      },
      {
        shell: "rust-tauri",
        artifactPath: "src-tauri/target/release/bundle/appimage/app.AppImage",
        sizeBytes: 62_000_000,
        startupMs: 1200,
        idleRssMb: 95,
      }
    );
    expect(res).toEqual({ passed: true, reasons: [] });
  });

  it("fails with explicit reasons when size ratio or startup exceeds gate", () => {
    const res = evaluateShellGate(
      {
        shell: "electron",
        artifactPath: "dist-desktop/app.AppImage",
        sizeBytes: 100_000_000,
      },
      {
        shell: "rust-tauri",
        artifactPath: "src-tauri/target/release/bundle/appimage/app.AppImage",
        sizeBytes: 85_000_000,
        startupMs: 3200,
        idleRssMb: 210,
      }
    );
    expect(res.passed).toBe(false);
    expect(res.reasons).toHaveLength(3);
  });
});
