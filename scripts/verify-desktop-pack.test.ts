import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createPackage } from "@electron/asar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs the real scripts/verify-desktop-pack.mjs against a fake unpacked app
// built in a temp dir, so the packaging contract is checked against its input
// rather than against a description of it.

const SCRIPT = path.resolve(__dirname, "verify-desktop-pack.mjs");

/** The updater closure, read from the same allowlist electron-builder uses. */
function updaterModules(): string[] {
  const yml = fs.readFileSync(
    path.resolve(__dirname, "..", "electron-builder.yml"),
    "utf8"
  );
  return [...yml.matchAll(/^\s*- node_modules\/([^/]+)\/\*\*\/\*\s*$/gm)].map(
    (m) => m[1]
  );
}

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-desktop-pack-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

async function buildUnpackedApp(options: {
  localBundle:
    | "complete"
    | "missing"
    | "no-required-server-files"
    | "no-node-modules";
}): Promise<string> {
  const appSrc = path.join(root, "app-src");
  write(
    path.join(appSrc, "package.json"),
    JSON.stringify({ name: "fixture", main: "electron-dist/main.js" })
  );
  write(path.join(appSrc, "electron-dist", "main.js"), "// shell\n");
  for (const name of updaterModules()) {
    write(
      path.join(appSrc, "node_modules", name, "package.json"),
      JSON.stringify({ name })
    );
  }

  const unpacked = path.join(root, "win-unpacked");
  const resources = path.join(unpacked, "resources");
  fs.mkdirSync(resources, { recursive: true });
  await createPackage(appSrc, path.join(resources, "app.asar"));

  if (options.localBundle !== "missing") {
    const bundle = path.join(resources, "local-bundle");
    write(path.join(bundle, "local-server-entry.cjs"), "// entry\n");
    // Server code and env-variable names are expected in the local bundle;
    // the asar-only rules must not flag them.
    write(
      path.join(bundle, "server.js"),
      "const url = process.env.DATABASE_URL;\n"
    );
    if (options.localBundle !== "no-required-server-files") {
      write(
        path.join(bundle, ".next", "required-server-files.json"),
        JSON.stringify({ config: {} })
      );
    }
    if (options.localBundle !== "no-node-modules") {
      write(
        path.join(bundle, "node_modules", "next", "package.json"),
        JSON.stringify({ name: "next" })
      );
      write(
        path.join(bundle, "node_modules", "@prisma", "client", "package.json"),
        JSON.stringify({ name: "@prisma/client" })
      );
    }
  }

  return unpacked;
}

function verify(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DESKTOP_UNPACKED_DIR: "", ...env },
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("scripts/verify-desktop-pack.mjs", () => {
  it("reads the full updater closure from electron-builder.yml", () => {
    expect(updaterModules()).toContain("electron-updater");
    expect(updaterModules().length).toBeGreaterThanOrEqual(17);
  });

  it("passes for a complete package, ignoring server code in local-bundle", async () => {
    const unpacked = await buildUnpackedApp({ localBundle: "complete" });
    const { status, output } = verify([unpacked]);
    expect(output).toContain("local bundle present");
    expect(output).toContain("no Next.js/React/Prisma server code in asar");
    expect(output).toContain("no secret or env material in asar text files");
    expect(output).toContain("Desktop packaging contract satisfied.");
    expect(status).toBe(0);
  });

  it("fails when resources/local-bundle is missing", async () => {
    const unpacked = await buildUnpackedApp({ localBundle: "missing" });
    const { status, output } = verify([unpacked]);
    expect(status).toBe(1);
    expect(output).toMatch(/missing resources[\\/]local-bundle[\\/]local-server-entry\.cjs/);
    expect(output).toMatch(
      /missing resources[\\/]local-bundle[\\/]\.next[\\/]required-server-files\.json/
    );
    expect(output).toContain("Desktop packaging contract FAILED.");
  });

  it("fails when required-server-files.json is missing", async () => {
    const unpacked = await buildUnpackedApp({
      localBundle: "no-required-server-files",
    });
    const { status, output } = verify([unpacked]);
    expect(status).toBe(1);
    expect(output).toContain("required-server-files.json");
    expect(output).not.toMatch(/missing .*local-server-entry\.cjs/);
  });

  it("fails when local-bundle/node_modules was dropped during packaging", async () => {
    const unpacked = await buildUnpackedApp({ localBundle: "no-node-modules" });
    const { status, output } = verify([unpacked]);
    expect(status).toBe(1);
    expect(output).toMatch(/missing .*node_modules[\\/]next[\\/]package\.json/);
    expect(output).toMatch(
      /missing .*node_modules[\\/]@prisma[\\/]client[\\/]package\.json/
    );
    expect(output).not.toMatch(/missing .*local-server-entry\.cjs/);
  });

  it("accepts the unpacked directory from DESKTOP_UNPACKED_DIR", async () => {
    const unpacked = await buildUnpackedApp({ localBundle: "missing" });
    const { status, output } = verify([], { DESKTOP_UNPACKED_DIR: unpacked });
    expect(status).toBe(1);
    expect(output).toContain(`Verifying packaged app in ${unpacked}`);
  });

  it("fails when the unpacked directory has no app.asar", () => {
    const { status, output } = verify([path.join(root, "nope")]);
    expect(status).toBe(1);
    expect(output).toContain("Packaged archive not found");
  });
});
