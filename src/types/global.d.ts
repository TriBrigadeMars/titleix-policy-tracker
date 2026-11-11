import { PrismaClient } from "@prisma/client";
import type { LocalDatabaseHandle } from "@/lib/local-runtime/pglite-bootstrap";

declare global {
  var prisma: PrismaClient | undefined;
  var __localDbHandlePromise: Promise<LocalDatabaseHandle> | undefined;
}
