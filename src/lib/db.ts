import { PrismaClient } from "@prisma/client";
import {
  bootstrapLocalPGlite,
  type LocalDatabaseHandle,
} from "./local-runtime/pglite-bootstrap";

export type DatabaseMode =
  | "embedded-disk"
  | "embedded-memory"
  | "postgres"
  | "unconfigured";

export interface DatabaseModeOptions {
  localMode?: string | boolean | undefined;
  databaseUrl?: string | null | undefined;
  nodeEnv?: string | undefined;
}

export function resolveDatabaseMode(options: DatabaseModeOptions): DatabaseMode {
  const isLocal =
    typeof options.localMode === "boolean"
      ? options.localMode
      : options.localMode === "1" || options.localMode === "true";

  if (isLocal) {
    return "embedded-disk";
  }

  const hasDatabaseUrl = Boolean(options.databaseUrl?.trim());
  if (hasDatabaseUrl) {
    return "postgres";
  }

  if (options.nodeEnv === "production") {
    return "unconfigured";
  }

  return "embedded-memory";
}

export const getDatabaseMode = resolveDatabaseMode;

function getEmbeddedPrisma(inMemory: boolean): Promise<PrismaClient> {
  if (!globalThis.__localDbHandlePromise) {
    globalThis.__localDbHandlePromise = bootstrapLocalPGlite({ inMemory });
  }
  return globalThis.__localDbHandlePromise.then((h: LocalDatabaseHandle) => h.prisma);
}

function createUnconfiguredPrisma(): PrismaClient {
  const errorMessage =
    "DATABASE_URL is not set. Refusing to start without a database in production.";
  const rejector = () => Promise.reject(new Error(errorMessage));

  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (prop === "then") return undefined;

      if (typeof prop === "string" && prop.startsWith("$")) {
        return rejector;
      }

      return new Proxy(
        {},
        {
          get(_delTarget, methodProp) {
            if (methodProp === "then") return undefined;
            return rejector;
          },
        }
      );
    },
  });
}

function createPostgresPrisma(): PrismaClient {
  const realClient = new PrismaClient();

  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (prop === "then") return undefined;

      if (prop === "$transaction") {
        return async (arg: unknown) => {
          if (Array.isArray(arg)) {
            return Promise.all(arg);
          }
          return (
            realClient.$transaction as unknown as (
              fn: unknown
            ) => Promise<unknown>
          )(arg);
        };
      }

      if (
        prop === "$queryRaw" ||
        prop === "$executeRaw" ||
        prop === "$connect" ||
        prop === "$disconnect"
      ) {
        return async (...args: unknown[]) => {
          const fn = Reflect.get(realClient, prop) as (
            ...a: unknown[]
          ) => Promise<unknown>;
          return await fn.apply(realClient, args);
        };
      }

      return new Proxy(
        {},
        {
          get(_delTarget, methodProp) {
            return async (...args: unknown[]) => {
              const realDel = Reflect.get(realClient, prop) as object;
              const realFn = Reflect.get(realDel, methodProp) as (
                ...a: unknown[]
              ) => Promise<unknown>;
              return await realFn.apply(realDel, args);
            };
          },
        }
      );
    },
  });
}

function createEmbeddedPrisma(inMemory: boolean): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (prop === "then") return undefined;

      if (prop === "$transaction") {
        return async (arg: unknown) => {
          const embedded = await getEmbeddedPrisma(inMemory);
          if (Array.isArray(arg)) {
            return Promise.all(arg);
          }
          return (
            embedded.$transaction as unknown as (
              fn: unknown
            ) => Promise<unknown>
          )(arg);
        };
      }

      if (
        prop === "$queryRaw" ||
        prop === "$executeRaw" ||
        prop === "$connect" ||
        prop === "$disconnect"
      ) {
        return async (...args: unknown[]) => {
          const embedded = await getEmbeddedPrisma(inMemory);
          const fn = Reflect.get(embedded, prop) as (
            ...a: unknown[]
          ) => Promise<unknown>;
          return fn.apply(embedded, args);
        };
      }

      return new Proxy(
        {},
        {
          get(_delTarget, methodProp) {
            return async (...args: unknown[]) => {
              const embedded = await getEmbeddedPrisma(inMemory);
              const del = Reflect.get(embedded, prop) as object;
              const fn = Reflect.get(del, methodProp) as (
                ...a: unknown[]
              ) => Promise<unknown>;
              return fn.apply(del, args);
            };
          },
        }
      );
    },
  });
}

export function createPrismaClient(options?: DatabaseModeOptions): PrismaClient {
  const mode = resolveDatabaseMode(
    options ?? {
      localMode: process.env.TITLEIX_LOCAL_MODE,
      databaseUrl: process.env.DATABASE_URL,
      nodeEnv: process.env.NODE_ENV,
    }
  );

  switch (mode) {
    case "embedded-disk":
      return createEmbeddedPrisma(false);
    case "embedded-memory":
      return createEmbeddedPrisma(true);
    case "postgres":
      return createPostgresPrisma();
    case "unconfigured":
      return createUnconfiguredPrisma();
  }
}

export const prisma = globalThis.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma;
