import * as fs from "node:fs";
import * as path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { Prisma, PrismaClient } from "@prisma/client";
import demoCorpusJson from "../../../prisma/fixtures/demo-corpus.json";
import { seedCatalogAndCorpus, type DemoCorpus } from "../seed-catalog";
import { ensurePrivateDir, resolveDataDir } from "./paths";

export const LOCAL_ADMIN_EMAIL = "local@titleix.local";
export const LOCAL_ADMIN_NAME = "Local Researcher";
const TEN_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 10;

export interface LocalDatabaseHandle {
  readonly pg: PGlite;
  readonly prisma: PrismaClient;
  close(): Promise<void>;
}

export interface BootstrapOptions {
  readonly inMemory?: boolean;
  readonly dataDir?: string;
  readonly migrationsDir?: string;
  readonly sessionToken?: string;
  readonly seedOnFirstRun?: boolean;
}

function resolveDefaultMigrationsDir(): string {
  const fromEnv = process.env.TITLEIX_MIGRATIONS_DIR?.trim();
  if (fromEnv) return fromEnv;
  return path.resolve(process.cwd(), "prisma", "migrations");
}

/**
 * Apply checked-in `prisma/migrations/<timestamp_name>/migration.sql` files in
 * lexical order against PGlite. Tracks applied migrations in
 * `_local_migrations` so restarts only apply newly shipped migrations.
 */
export async function applyCheckedInMigrations(
  pg: PGlite,
  migrationsDir: string = resolveDefaultMigrationsDir()
): Promise<string[]> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS _local_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedResult = await pg.query<{ name: string }>(
    "SELECT name FROM _local_migrations;"
  );
  const applied = new Set(appliedResult.rows.map((r) => r.name));

  const entries = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const newlyApplied: string[] = [];

  for (const dirName of entries) {
    if (applied.has(dirName)) continue;
    const sqlPath = path.join(migrationsDir, dirName, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;

    const sql = fs.readFileSync(sqlPath, "utf8");
    await pg.exec("BEGIN;");
    try {
      await pg.exec(sql);
      await pg.query("INSERT INTO _local_migrations (name) VALUES ($1);", [
        dirName,
      ]);
      await pg.exec("COMMIT;");
      newlyApplied.push(dirName);
    } catch (err) {
      await pg.exec("ROLLBACK;");
      throw err;
    }
  }

  return newlyApplied;
}

/**
 * Provision the single local user (`ADMIN`) and bind `sessionToken` in the
 * Auth.js `sessions` table so unmodified pages and API routes authenticate
 * every request forwarded by the desktop shell.
 */
export async function ensureLocalSession(
  prisma: PrismaClient,
  sessionToken: string
): Promise<void> {
  const trimmed = sessionToken.trim();
  if (!trimmed) {
    throw new Error("Local session token must be non-empty");
  }

  const user = await prisma.user.upsert({
    where: { email: LOCAL_ADMIN_EMAIL },
    update: { role: "ADMIN" },
    create: {
      email: LOCAL_ADMIN_EMAIL,
      name: LOCAL_ADMIN_NAME,
      role: "ADMIN",
    },
  });

  const expires = new Date(Date.now() + TEN_YEARS_MS);
  await prisma.session.upsert({
    where: { sessionToken: trimmed },
    update: { userId: user.id, expires },
    create: {
      sessionToken: trimmed,
      userId: user.id,
      expires,
    },
  });
}

/**
 * Initialize PGlite (on disk in `$XDG_DATA_HOME/titleix-policy-tracker/pgdata`
 * or in-memory), apply checked-in Prisma migrations, seed on first run, and
 * register the local desktop session when `sessionToken` is supplied.
 */
export async function bootstrapLocalPGlite(
  options: BootstrapOptions = {}
): Promise<LocalDatabaseHandle> {
  let pg: PGlite;
  if (options.inMemory) {
    pg = new PGlite();
  } else {
    const baseDir = options.dataDir ?? resolveDataDir();
    ensurePrivateDir(baseDir);
    const pgDataDir = path.join(baseDir, "pgdata");
    ensurePrivateDir(pgDataDir);
    pg = new PGlite(pgDataDir);
  }

  await applyCheckedInMigrations(pg, options.migrationsDir);

  const adapter =
    new PrismaPGlite(pg) as unknown as Prisma.PrismaClientOptions["adapter"];
  const prisma = new PrismaClient({ adapter });

  if (options.seedOnFirstRun !== false) {
    const existingCount = await prisma.jurisdiction.count();
    if (existingCount === 0) {
      await seedCatalogAndCorpus(prisma, demoCorpusJson as DemoCorpus);
    }
  }

  const token =
    options.sessionToken ?? process.env.TITLEIX_SESSION_TOKEN?.trim();
  if (token) {
    await ensureLocalSession(prisma, token);
  }

  let closed = false;
  return {
    pg,
    prisma,
    async close() {
      if (closed) return;
      closed = true;
      await prisma.$disconnect();
      await pg.close();
    },
  };
}
