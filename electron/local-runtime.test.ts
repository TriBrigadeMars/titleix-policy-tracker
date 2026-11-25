import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveShellConfigDir,
  resolveShellDataDir,
  resolveShellRuntimeDir,
  resolveShellSocketPath,
} from "./local-runtime";

// The Electron shell resolves the same Windows paths as the local server
// (src/lib/local-runtime/paths.ts). These assertions run on every platform
// because the functions take `platform` as an argument; the windows-latest CI
// job runs the same file natively.
describe("Electron shell paths on Windows", () => {
  it("uses a per-user named pipe, never a TCP port", () => {
    expect(resolveShellSocketPath({ USERNAME: "alice" }, "win32")).toBe(
      "\\\\.\\pipe\\titleix-policy-tracker-alice"
    );
    expect(resolveShellSocketPath({ USERNAME: "Alice Smith" }, "win32")).toBe(
      "\\\\.\\pipe\\titleix-policy-tracker-Alice_Smith"
    );
    expect(resolveShellSocketPath({}, "win32")).toBe(
      "\\\\.\\pipe\\titleix-policy-tracker-local"
    );
  });

  it("honours the TITLEIX_SOCKET_PATH override", () => {
    expect(
      resolveShellSocketPath(
        { TITLEIX_SOCKET_PATH: "\\\\.\\pipe\\custom", USERNAME: "alice" },
        "win32"
      )
    ).toBe("\\\\.\\pipe\\custom");
  });

  it("stores data and config under %APPDATA%", () => {
    const env = { APPDATA: "C:\\Users\\alice\\AppData\\Roaming" };
    expect(resolveShellDataDir(env, "win32", "C:\\Users\\alice")).toBe(
      path.win32.join("C:\\Users\\alice\\AppData\\Roaming", "titleix-policy-tracker")
    );
    expect(resolveShellConfigDir(env, "win32", "C:\\Users\\alice")).toBe(
      path.win32.join("C:\\Users\\alice\\AppData\\Roaming", "titleix-policy-tracker")
    );
  });

  it("falls back to <home>\\AppData\\Roaming when APPDATA is unset", () => {
    expect(resolveShellDataDir({}, "win32", "C:\\Users\\alice")).toBe(
      path.win32.join("C:\\Users\\alice", "AppData", "Roaming", "titleix-policy-tracker")
    );
  });
});

describe("Electron shell paths on Linux", () => {
  it("uses $XDG_RUNTIME_DIR for the socket and $XDG_DATA_HOME for the database", () => {
    expect(
      resolveShellSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" }, "linux", 1000)
    ).toBe("/run/user/1000/titleix-policy-tracker/app.sock");
    expect(
      resolveShellRuntimeDir({}, "linux", 1001)
    ).toContain("titleix-policy-tracker-1001");
    expect(
      resolveShellDataDir(
        { XDG_DATA_HOME: "/home/alice/.local/share" },
        "linux",
        "/home/alice"
      )
    ).toBe("/home/alice/.local/share/titleix-policy-tracker");
  });
});
