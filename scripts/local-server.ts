import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import next from "next";
import { bootstrapLocalPGlite } from "../src/lib/local-runtime/pglite-bootstrap";
import {
  resolveDataDir,
  resolveSocketPath,
} from "../src/lib/local-runtime/paths";
import { listenOnUnixSocket } from "../src/lib/local-runtime/uds-http";

async function startLocalServer(): Promise<void> {
  process.env.TITLEIX_LOCAL_MODE = "1";
  const appDir = process.env.TITLEIX_APP_DIR
    ? path.resolve(process.env.TITLEIX_APP_DIR)
    : process.cwd();
  const dataDir = resolveDataDir();
  const socketPath = resolveSocketPath();
  const sessionToken = process.env.TITLEIX_SESSION_TOKEN?.trim();
  const dev = process.env.TITLEIX_NEXT_DEV === "1";

  const migrationsDir =
    process.env.TITLEIX_MIGRATIONS_DIR?.trim() ||
    path.join(appDir, "prisma", "migrations");

  // Share the booted PGlite handle with Next.js route workers in this process
  const dbPromise = bootstrapLocalPGlite({
    dataDir,
    migrationsDir,
    sessionToken,
  });
  globalThis.__localDbHandlePromise = dbPromise;
  const dbHandle = await dbPromise;
  globalThis.prisma = dbHandle.prisma;

  const nextApp = next({ dev, dir: appDir });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error("[local-server] request failed:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
  });

  await listenOnUnixSocket(server, socketPath);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[local-server] received ${signal}, shutting down cleanly`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (process.platform !== "win32" && fs.existsSync(socketPath)) {
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // Ignore if already unlinked
      }
    }
    await dbHandle.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  process.stdout.write(`READY ${socketPath}\n`);
}

startLocalServer().catch((err: unknown) => {
  console.error("[local-server] fatal startup failure:", err);
  process.exit(1);
});
