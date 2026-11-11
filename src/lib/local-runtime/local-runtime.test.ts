import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensurePrivateDir,
  resolveDataDir,
  resolveRuntimeDir,
  resolveSocketPath,
} from "./paths";
import {
  forwardOverUnixSocket,
  listenOnUnixSocket,
  mergeSessionCookie,
} from "./uds-http";
import {
  bootstrapLocalPGlite,
  LOCAL_ADMIN_EMAIL,
} from "./pglite-bootstrap";

describe("local-runtime XDG paths & 0700 permissions", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses $XDG_RUNTIME_DIR/titleix-policy-tracker/app.sock on Linux", () => {
    const sock = resolveSocketPath(
      { XDG_RUNTIME_DIR: "/run/user/1000" },
      "linux",
      1000
    );
    expect(sock).toBe("/run/user/1000/titleix-policy-tracker/app.sock");
  });

  it("falls back to a per-UID tmp runtime directory when XDG_RUNTIME_DIR is unset", () => {
    const dir = resolveRuntimeDir({}, "linux", 1001);
    expect(dir).toContain("titleix-policy-tracker-1001");
  });

  it("uses $XDG_DATA_HOME/titleix-policy-tracker on Linux and ~/.local/share fallback", () => {
    expect(
      resolveDataDir(
        { XDG_DATA_HOME: "/home/alice/.local/share-custom" },
        "linux",
        "/home/alice"
      )
    ).toBe("/home/alice/.local/share-custom/titleix-policy-tracker");

    expect(resolveDataDir({}, "linux", "/home/alice")).toBe(
      "/home/alice/.local/share/titleix-policy-tracker"
    );
  });

  it("enforces mode 0700 on runtime and data directories", () => {
    const tmp = path.join(
      os.tmpdir(),
      `titleix-perm-test-${process.pid}-${Date.now()}`
    );
    tempDirs.push(tmp);
    fs.mkdirSync(tmp, { mode: 0o755 });
    ensurePrivateDir(tmp, "linux");
    const mode = fs.statSync(tmp).mode & 0o777;
    expect(mode).toBe(0o700);
  });
});

describe("Unix domain socket server & session cookie injection (zero TCP port)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("injects authjs.session-token and strips spoofed session cookies", () => {
    expect(mergeSessionCookie(undefined, "secret-tok")).toBe(
      "authjs.session-token=secret-tok"
    );
    expect(
      mergeSessionCookie(
        "theme=dark; authjs.session-token=attacker; __Secure-authjs.session-token=bad",
        "secret-tok"
      )
    ).toBe("authjs.session-token=secret-tok; theme=dark");
  });

  it("binds exclusively to a Unix socket (string address, no TCP port) and forwards requests with Cookie", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tix-uds-"));
    tempDirs.push(runtimeRoot);
    const socketPath = path.join(runtimeRoot, "runtime", "app.sock");

    const server = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          url: req.url,
          host: req.headers.host,
          cookie: req.headers.cookie,
        })
      );
    });

    await listenOnUnixSocket(server, socketPath);

    try {
      // Prove no TCP port is bound: server.address() on UDS is the socket path string
      expect(server.address()).toBe(socketPath);
      expect(fs.statSync(path.dirname(socketPath)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);

      // Refuses to clobber an active listener
      const duplicate = http.createServer();
      await expect(listenOnUnixSocket(duplicate, socketPath)).rejects.toThrow(
        /already listening/
      );

      const response = await forwardOverUnixSocket(
        {
          method: "GET",
          path: "/triage?relevance=unreviewed",
          headers: { Cookie: "authjs.session-token=forged; pref=compact" },
        },
        socketPath,
        "local-session-xyz"
      );

      expect(response.statusCode).toBe(200);
      const parsed = JSON.parse(response.body.toString("utf8")) as {
        url: string;
        host: string;
        cookie: string;
      };
      expect(parsed).toEqual({
        url: "/triage?relevance=unreviewed",
        host: "tracker",
        cookie: "authjs.session-token=local-session-xyz; pref=compact",
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("PGlite local database bootstrap (migrations + seed + local session)", () => {
  it(
    "applies all checked-in Prisma migrations, seeds on first run, and binds the local ADMIN session",
    async () => {
      const handle = await bootstrapLocalPGlite({
        inMemory: true,
        sessionToken: "desktop-tok-123",
      });

      try {
        const [jurCount, tagCount, instCount, session] = await Promise.all([
          handle.prisma.jurisdiction.count(),
          handle.prisma.issueTag.count(),
          handle.prisma.instrument.count(),
          handle.prisma.session.findUnique({
            where: { sessionToken: "desktop-tok-123" },
            include: { user: true },
          }),
        ]);

        expect(jurCount).toBe(52);
        expect(tagCount).toBe(8);
        expect(instCount).toBeGreaterThanOrEqual(10);
        expect(session?.user.email).toBe(LOCAL_ADMIN_EMAIL);
        expect(session?.user.role).toBe("ADMIN");

        // Verify heatmap raw SQL query works against migrated PGlite schema
        const rawTagCounts = await handle.prisma.$queryRaw<
          { jurisdiction_id: string; tag_count: bigint }[]
        >`
          SELECT i.jurisdiction_id, COUNT(DISTINCT iit.issue_tag_id) AS tag_count
          FROM instrument_issue_tags iit
          JOIN instruments i ON i.id = iit.instrument_id
          WHERE i.triage_status = 'RELEVANT'
          GROUP BY i.jurisdiction_id
        `;
        expect(rawTagCounts.length).toBeGreaterThan(0);
      } finally {
        await handle.close();
      }
    },
    20_000
  );
});
