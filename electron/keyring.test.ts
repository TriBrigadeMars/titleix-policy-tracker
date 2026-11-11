import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readIngestKeysFromKeyring } from "./keyring";
import {
  injectSessionCookieHeader,
  proxyCustomSchemeToSocket,
} from "./local-runtime";

describe("readIngestKeysFromKeyring", () => {
  it("reads available ingest keys from OS keyring and falls back per-key", async () => {
    const store: Record<string, string> = {
      CONGRESS_GOV_API_KEY: "  cg_secret_123  ",
      LEGISCAN_API_KEY: "",
    };

    const env = await readIngestKeysFromKeyring({
      lookup: async (_service, key) => store[key] ?? null,
      fallback: {
        LEGISCAN_API_KEY: "ls_fallback_456",
        OPEN_STATES_API_KEY: "os_fallback_789",
      },
    });

    expect(env).toEqual({
      CONGRESS_GOV_API_KEY: "cg_secret_123",
      LEGISCAN_API_KEY: "ls_fallback_456",
      OPEN_STATES_API_KEY: "os_fallback_789",
    });
    expect(env.LEGISCAN_SESSION_ID).toBeUndefined();
  });
});

describe("proxyCustomSchemeToSocket", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("forwards app://tracker requests over Unix socket, injects session cookie, and strips Set-Cookie", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "electron-uds-"));
    tempDirs.push(dir);
    const socketPath = path.join(dir, "app.sock");

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Set-Cookie", "authjs.session-token=leak; HttpOnly");
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            cookie: req.headers.cookie,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    try {
      const request = new Request("app://tracker/api/cell-notes?id=abc", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: "authjs.session-token=spoofed; ui=compact",
        },
        body: JSON.stringify({ body: "Updated local note" }),
      });

      const response = await proxyCustomSchemeToSocket(
        request,
        socketPath,
        "trusted-desktop-token"
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();
      const payload = (await response.json()) as Record<string, string>;
      expect(payload).toEqual({
        method: "PUT",
        url: "/api/cell-notes?id=abc",
        cookie: "authjs.session-token=trusted-desktop-token; ui=compact",
        body: '{"body":"Updated local note"}',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("injectSessionCookieHeader preserves non-session cookies", () => {
    expect(injectSessionCookieHeader("a=1; b=2", "tok")).toBe(
      "authjs.session-token=tok; a=1; b=2"
    );
  });
});
