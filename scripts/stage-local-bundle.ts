import * as fs from "node:fs";
import * as path from "node:path";
import {
  ISSUE_TAGS_CATALOG,
  JURISDICTIONS_CATALOG,
} from "../src/lib/seed-catalog";

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(srcPath);
      if (fs.statSync(real).isDirectory()) {
        copyDirRecursive(real, destPath);
      } else {
        fs.copyFileSync(real, destPath);
      }
    } else if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function buildStandaloneEntryScript(): string {
  return `"use strict";
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const JURISDICTIONS = ${JSON.stringify(JURISDICTIONS_CATALOG)};
const ISSUE_TAGS = ${JSON.stringify(ISSUE_TAGS_CATALOG)};

function ensurePrivateDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    fs.chmodSync(dirPath, 0o700);
  }
}

async function applyMigrations(pg, migrationsDir) {
  await pg.exec(\`
    CREATE TABLE IF NOT EXISTS _local_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  \`);
  const res = await pg.query("SELECT name FROM _local_migrations;");
  const applied = new Set(res.rows.map((r) => r.name));
  const dirs = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const dirName of dirs) {
    if (applied.has(dirName)) continue;
    const sqlFile = path.join(migrationsDir, dirName, "migration.sql");
    if (!fs.existsSync(sqlFile)) continue;
    const sql = fs.readFileSync(sqlFile, "utf8");
    await pg.exec("BEGIN;");
    try {
      await pg.exec(sql);
      await pg.query("INSERT INTO _local_migrations (name) VALUES ($1);", [dirName]);
      await pg.exec("COMMIT;");
    } catch (err) {
      await pg.exec("ROLLBACK;");
      throw err;
    }
  }
}

async function seedFirstRun(prisma, appDir) {
  const existing = await prisma.jurisdiction.count();
  if (existing > 0) return;

  for (const j of JURISDICTIONS) {
    await prisma.jurisdiction.upsert({ where: { code: j.code }, update: {}, create: j });
  }
  for (const tag of ISSUE_TAGS) {
    await prisma.issueTag.upsert({ where: { slug: tag.slug }, update: {}, create: tag });
  }

  const corpusPath = path.join(appDir, "prisma", "fixtures", "demo-corpus.json");
  if (!fs.existsSync(corpusPath)) return;
  const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
  const checkedAt = new Date(corpus.checkedAt);

  const jurisdictions = await prisma.jurisdiction.findMany({ select: { id: true, code: true } });
  const codeToId = new Map(jurisdictions.map((j) => [j.code, j.id]));
  const tags = await prisma.issueTag.findMany({ select: { id: true, slug: true } });
  const slugToId = new Map(tags.map((t) => [t.slug, t.id]));

  for (const row of corpus.instruments) {
    const jurisdictionId = codeToId.get(row.jurisdictionCode);
    if (!jurisdictionId) continue;
    const inst = await prisma.instrument.upsert({
      where: {
        jurisdictionId_type_identifier: {
          jurisdictionId,
          type: row.type,
          identifier: row.identifier,
        },
      },
      create: {
        jurisdictionId,
        type: row.type,
        identifier: row.identifier,
        title: row.title,
        status: row.status,
        triageStatus: row.triageStatus,
        relevanceConfidence: row.relevanceConfidence,
        source: row.source,
        sourceId: row.sourceId,
        sourceUrl: row.sourceUrl,
        rawSummary: row.rawSummary,
        lastCheckedAt: checkedAt,
      },
      update: {},
    });
    const tagIds = (row.issueTagSlugs || []).map((s) => slugToId.get(s)).filter(Boolean);
    if (tagIds.length > 0) {
      await prisma.instrumentIssueTag.createMany({
        data: tagIds.map((issueTagId) => ({ instrumentId: inst.id, issueTagId })),
      });
    }
  }

  for (const note of corpus.cellNotes || []) {
    const jurisdictionId = codeToId.get(note.jurisdictionCode);
    const issueTagId = slugToId.get(note.issueTagSlug);
    if (!jurisdictionId || !issueTagId) continue;
    await prisma.cellNote.upsert({
      where: { jurisdictionId_issueTagId: { jurisdictionId, issueTagId } },
      create: { jurisdictionId, issueTagId, body: note.body },
      update: { body: note.body },
    });
  }

  await prisma.ingestRun.create({
    data: {
      source: "fixture",
      status: "SUCCESS",
      startedAt: checkedAt,
      finishedAt: checkedAt,
      upserted: corpus.instruments.length,
      skipped: 0,
      dropped: 0,
    },
  });
}

function probeSocket(socketPath) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ path: socketPath });
    sock.once("connect", () => {
      sock.destroy();
      resolve("LIVE");
    });
    sock.once("error", () => {
      sock.destroy();
      resolve("STALE");
    });
  });
}

async function main() {
  const appDir = process.env.TITLEIX_APP_DIR || __dirname;
  const dataDir = process.env.TITLEIX_DATA_DIR;
  const socketPath = process.env.TITLEIX_SOCKET_PATH;
  const sessionToken = (process.env.TITLEIX_SESSION_TOKEN || "").trim();

  if (!dataDir || !socketPath) {
    throw new Error("TITLEIX_DATA_DIR and TITLEIX_SOCKET_PATH are required");
  }

  process.chdir(appDir);
  process.env.NODE_ENV = "production";
  process.env.TITLEIX_LOCAL_MODE = "1";

  ensurePrivateDir(dataDir);
  const pgDataDir = path.join(dataDir, "pgdata");
  ensurePrivateDir(pgDataDir);

  const { PGlite } = await import("@electric-sql/pglite");
  const { PrismaPGlite } = await import("pglite-prisma-adapter");
  const { PrismaClient } = require("@prisma/client");

  const pg = new PGlite(pgDataDir);
  await applyMigrations(pg, path.join(appDir, "prisma", "migrations"));
  const adapter = new PrismaPGlite(pg);
  const prisma = new PrismaClient({ adapter });

  await seedFirstRun(prisma, appDir);

  if (sessionToken) {
    const user = await prisma.user.upsert({
      where: { email: "local@titleix.local" },
      update: { role: "ADMIN" },
      create: { email: "local@titleix.local", name: "Local Researcher", role: "ADMIN" },
    });
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10);
    await prisma.session.upsert({
      where: { sessionToken },
      update: { userId: user.id, expires },
      create: { sessionToken, userId: user.id, expires },
    });
  }

  const handle = {
    pg,
    prisma,
    close: async () => {
      await prisma.$disconnect();
      await pg.close();
    },
  };
  globalThis.prisma = prisma;
  globalThis.__localDbHandlePromise = Promise.resolve(handle);

  const requiredFiles = JSON.parse(
    fs.readFileSync(path.join(appDir, ".next", "required-server-files.json"), "utf8")
  );
  const NextNodeServer = require("next/dist/server/next-server").default;
  const nextServer = new NextNodeServer({
    conf: requiredFiles.config,
    dir: appDir,
    minimalMode: false,
    customServer: true,
  });
  const requestHandler = nextServer.getRequestHandler();

  if (process.platform !== "win32") {
    ensurePrivateDir(path.dirname(socketPath));
    if (fs.existsSync(socketPath)) {
      const status = await probeSocket(socketPath);
      if (status === "LIVE") {
        throw new Error("Socket already in use: " + socketPath);
      }
      fs.unlinkSync(socketPath);
    }
  }

  const server = http.createServer((req, res) => {
    requestHandler(req, res).catch((err) => {
      console.error("[local-server] error:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      if (process.platform !== "win32") {
        fs.chmodSync(socketPath, 0o600);
      }
      resolve();
    });
  });

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await new Promise((r) => server.close(() => r()));
    if (process.platform !== "win32" && fs.existsSync(socketPath)) {
      try { fs.unlinkSync(socketPath); } catch {}
    }
    await handle.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  process.stdout.write("READY " + socketPath + "\\n");
}

main().catch((err) => {
  console.error("[local-server] fatal:", err);
  process.exit(1);
});
`;
}

function stageLocalBundle(): void {
  const root = process.cwd();
  const standaloneDir = path.join(root, ".next", "standalone");
  if (!fs.existsSync(standaloneDir)) {
    throw new Error(
      "Missing .next/standalone — run `npm run build` before staging the local bundle."
    );
  }

  const outDir = path.join(root, "local-bundle");
  fs.rmSync(outDir, { recursive: true, force: true });
  copyDirRecursive(standaloneDir, outDir);

  copyDirRecursive(
    path.join(root, ".next", "static"),
    path.join(outDir, ".next", "static")
  );
  copyDirRecursive(path.join(root, "public"), path.join(outDir, "public"));
  copyDirRecursive(
    path.join(root, "prisma", "migrations"),
    path.join(outDir, "prisma", "migrations")
  );
  copyDirRecursive(
    path.join(root, "prisma", "fixtures"),
    path.join(outDir, "prisma", "fixtures")
  );

  // Ensure @electric-sql/pglite and pglite-prisma-adapter are present in standalone node_modules
  for (const pkg of [
    "@electric-sql/pglite",
    "pglite-prisma-adapter",
    "@prisma/driver-adapter-utils",
    "@prisma/debug",
    "postgres-array",
  ]) {
    const srcPkg = path.join(root, "node_modules", pkg);
    const destPkg = path.join(outDir, "node_modules", pkg);
    if (fs.existsSync(srcPkg) && !fs.existsSync(destPkg)) {
      copyDirRecursive(srcPkg, destPkg);
    }
  }

  for (const entry of fs.readdirSync(outDir)) {
    if (entry.startsWith(".env")) {
      fs.rmSync(path.join(outDir, entry), { force: true });
    }
  }

  fs.writeFileSync(
    path.join(outDir, "local-server-entry.cjs"),
    buildStandaloneEntryScript(),
    "utf8"
  );

  console.log(`Staged standalone local bundle at ${outDir}`);
}

stageLocalBundle();
