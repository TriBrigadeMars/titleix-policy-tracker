import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultExecutableName,
  defaultUnpackedDir,
  looksLikeAppPage,
  requestOverSocket,
  resolveSmokeTarget,
  smokeSocketPath,
} from "./smoke-local-server.mjs";

// The packaged-app smoke is what proves "a stranger can install and run this".
// These tests cover the parts that are logic rather than process orchestration;
// scripts/smoke-local-server.mjs itself is exercised by CI against a real pack.

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "titleix-smoke-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("smoke target resolution", () => {
  it("defaults to the platform's electron-builder output and executable", () => {
    expect(defaultUnpackedDir("linux")).toBe(
      path.join("dist-desktop", "linux-unpacked")
    );
    expect(defaultUnpackedDir("win32")).toBe(
      path.join("dist-desktop", "win-unpacked")
    );
    expect(defaultExecutableName("linux")).toBe("titleix-policy-tracker");
    expect(defaultExecutableName("win32")).toBe(
      "Title IX Policy Tracker.exe"
    );
  });

  it("names the missing file instead of failing on a bare ENOENT", () => {
    const root = tempDir();
    expect(() => resolveSmokeTarget({ unpackedDir: root })).toThrow(
      /packaged executable not found/i
    );
    // Create only the executable: the error must then point at the bundle.
    const exe = path.join(root, defaultExecutableName("linux"));
    fs.writeFileSync(exe, "");
    expect(() =>
      resolveSmokeTarget({ unpackedDir: root, platform: "linux" })
    ).toThrow(/local server entry not found/i);
  });

  it("resolves a real unpacked layout", () => {
    const root = tempDir();
    const bundles = path.join(root, "resources", "local-bundle");
    fs.mkdirSync(bundles, { recursive: true });
    fs.writeFileSync(path.join(root, "Title IX Policy Tracker.exe"), "");
    fs.writeFileSync(path.join(bundles, "local-server-entry.cjs"), "");
    const target = resolveSmokeTarget({
      unpackedDir: root,
      platform: "win32",
    });
    expect(target.entryPath).toBe(
      path.join(root, "resources", "local-bundle", "local-server-entry.cjs")
    );
    expect(target.exePath).toBe(
      path.join(root, "Title IX Policy Tracker.exe")
    );
  });
});

describe("smoke IPC endpoint", () => {
  it("uses a named pipe on Windows and a socket file elsewhere", () => {
    const dir = tempDir();
    const pipe = smokeSocketPath(dir, "win32");
    expect(pipe.startsWith("\\\\.\\pipe\\titleix-smoke-")).toBe(true);
    expect(pipe).not.toBe(smokeSocketPath(dir, "win32"));
    expect(smokeSocketPath(dir, "linux")).toBe(path.join(dir, "app.sock"));
  });

  // Runs for real on windows-latest too, where this binds a named pipe.
  it("round-trips an HTTP request over the endpoint", async () => {
    const dir = tempDir();
    const socketPath = smokeSocketPath(dir);
    const server = http.createServer((req, res) => {
      res.statusCode = 200;
      res.end(`ok ${req.headers.cookie ?? ""}`);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    try {
      const response = await requestOverSocket({
        socketPath,
        cookie: "authjs.session-token=abc",
      });
      expect(response.status).toBe(200);
      expect(response.body).toBe("ok authjs.session-token=abc");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("app page assertions", () => {
  const page =
    `<html><body><h1>Title IX Policy Tracker</h1>${"<p>row</p>".repeat(
      200
    )}</body></html>`;

  it("accepts a rendered page", () => {
    expect(looksLikeAppPage(page)).toEqual({
      ok: true,
      reason: "rendered app page",
    });
  });

  it("rejects empty, short and error responses", () => {
    expect(looksLikeAppPage("").ok).toBe(false);
    expect(looksLikeAppPage("<h1>Title IX</h1>").ok).toBe(false);
    const errorPage = `${page}Internal Server Error`;
    expect(looksLikeAppPage(errorPage)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Internal Server Error"),
    });
    expect(
      looksLikeAppPage(`${page}AUTH_SECRET is not set`).reason
    ).toContain("AUTH_SECRET is not set");
    expect(
      looksLikeAppPage(`${"<p>x</p>".repeat(200)}nothing here`).reason
    ).toContain("Title IX");
  });
});
