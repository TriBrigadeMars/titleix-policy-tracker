import * as fs from "node:fs";
import * as path from "node:path";

export interface ShellMetrics {
  readonly shell: "electron" | "rust-tauri";
  readonly artifactPath: string;
  readonly sizeBytes: number;
  readonly startupMs?: number;
  readonly idleRssMb?: number;
}

export interface GateThresholds {
  /** Rust AppImage must be at least 40% smaller than the Electron AppImage. */
  readonly maxSizeRatioVsElectron: number;
  /** Maximum cold-start-to-socket-ready latency in milliseconds. */
  readonly maxStartupMs: number;
  /** Maximum idle shell RSS in MiB (excluding WebKit/Chromium shared libs). */
  readonly maxIdleRssMb: number;
}

export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  maxSizeRatioVsElectron: 0.6,
  maxStartupMs: 2500,
  maxIdleRssMb: 180,
};

export interface GateEvaluation {
  readonly passed: boolean;
  readonly reasons: string[];
}

export function evaluateShellGate(
  electron: ShellMetrics,
  rust: ShellMetrics,
  thresholds: GateThresholds = DEFAULT_GATE_THRESHOLDS
): GateEvaluation {
  const reasons: string[] = [];

  if (electron.sizeBytes <= 0 || rust.sizeBytes <= 0) {
    reasons.push("Artifact size must be positive for both shells.");
  } else {
    const ratio = rust.sizeBytes / electron.sizeBytes;
    if (ratio > thresholds.maxSizeRatioVsElectron) {
      reasons.push(
        `Rust bundle size ratio ${ratio.toFixed(2)} exceeds gate ${thresholds.maxSizeRatioVsElectron}`
      );
    }
  }

  if (
    rust.startupMs !== undefined &&
    rust.startupMs > thresholds.maxStartupMs
  ) {
    reasons.push(
      `Rust startup ${rust.startupMs}ms exceeds gate ${thresholds.maxStartupMs}ms`
    );
  }

  if (
    rust.idleRssMb !== undefined &&
    rust.idleRssMb > thresholds.maxIdleRssMb
  ) {
    reasons.push(
      `Rust idle RSS ${rust.idleRssMb}MiB exceeds gate ${thresholds.maxIdleRssMb}MiB`
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

function findFirstAppImage(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFirstAppImage(full);
      if (nested) return nested;
    } else if (entry.name.endsWith(".AppImage")) {
      return full;
    }
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const electronImg = findFirstAppImage(
    path.resolve(process.cwd(), "dist-desktop")
  );
  const tauriImg = findFirstAppImage(
    path.resolve(process.cwd(), "src-tauri", "target", "release", "bundle")
  );

  if (!electronImg || !tauriImg) {
    console.log(
      JSON.stringify(
        {
          status: "SKIPPED_MISSING_ARTIFACTS",
          electronAppImage: electronImg,
          tauriAppImage: tauriImg,
          note: "Build both AppImages (`npm run desktop:dist:appimage` and `npm run tauri:build`) to evaluate the shell promotion gate.",
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const electronMetrics: ShellMetrics = {
    shell: "electron",
    artifactPath: electronImg,
    sizeBytes: fs.statSync(electronImg).size,
  };
  const rustMetrics: ShellMetrics = {
    shell: "rust-tauri",
    artifactPath: tauriImg,
    sizeBytes: fs.statSync(tauriImg).size,
  };

  const verdict = evaluateShellGate(electronMetrics, rustMetrics);
  console.log(
    JSON.stringify({ electronMetrics, rustMetrics, verdict }, null, 2)
  );
  process.exit(verdict.passed ? 0 : 1);
}
