import { PrismaClient } from "@prisma/client";
import {
  bootstrapLocalPGlite,
  type LocalDatabaseHandle,
} from "./local-runtime/pglite-bootstrap";

function isDatabaseOfflineError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";

  if (
    name === "PrismaClientInitializationError" ||
    code === "P1000" ||
    code === "P1001" ||
    code === "P1002" ||
    code === "P1003" ||
    code === "P1017"
  ) {
    return true;
  }

  return /Can't reach database server|Environment variable not found: DATABASE_URL|ECONNREFUSED|Connection terminated/i.test(
    message
  );
}

function getEmbeddedPrisma(inMemory: boolean): Promise<PrismaClient> {
  if (!globalThis.__localDbHandlePromise) {
    globalThis.__localDbHandlePromise = bootstrapLocalPGlite({ inMemory });
  }
  return globalThis.__localDbHandlePromise.then((h: LocalDatabaseHandle) => h.prisma);
}

function createPrismaClient(): PrismaClient {
  const isLocalMode = process.env.TITLEIX_LOCAL_MODE === "1";
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());

  let useEmbedded = isLocalMode || !hasDatabaseUrl;
  const embedInMemory = !isLocalMode;
  let realClient: PrismaClient | null = null;

  if (!useEmbedded) {
    try {
      realClient = new PrismaClient();
    } catch {
      useEmbedded = true;
    }
  }

  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (prop === "then") return undefined;

      if (prop === "$transaction") {
        return async (arg: unknown) => {
          if (useEmbedded || !realClient) {
            const embedded = await getEmbeddedPrisma(embedInMemory);
            if (Array.isArray(arg)) {
              return Promise.all(arg);
            }
            return (
              embedded.$transaction as unknown as (
                fn: unknown
              ) => Promise<unknown>
            )(arg);
          }
          if (Array.isArray(arg)) {
            return Promise.all(arg);
          }
          try {
            return await (
              realClient.$transaction as unknown as (
                fn: unknown
              ) => Promise<unknown>
            )(arg);
          } catch (err) {
            if (isDatabaseOfflineError(err)) {
              useEmbedded = true;
              const embedded = await getEmbeddedPrisma(embedInMemory);
              return (
                embedded.$transaction as unknown as (
                  fn: unknown
                ) => Promise<unknown>
              )(arg);
            }
            throw err;
          }
        };
      }

      if (
        prop === "$queryRaw" ||
        prop === "$executeRaw" ||
        prop === "$connect" ||
        prop === "$disconnect"
      ) {
        return async (...args: unknown[]) => {
          if (useEmbedded || !realClient) {
            const embedded = await getEmbeddedPrisma(embedInMemory);
            const fn = Reflect.get(embedded, prop) as (
              ...a: unknown[]
            ) => Promise<unknown>;
            return fn.apply(embedded, args);
          }
          try {
            const fn = Reflect.get(realClient, prop) as (
              ...a: unknown[]
            ) => Promise<unknown>;
            return await fn.apply(realClient, args);
          } catch (err) {
            if (isDatabaseOfflineError(err)) {
              useEmbedded = true;
              const embedded = await getEmbeddedPrisma(embedInMemory);
              const fn = Reflect.get(embedded, prop) as (
                ...a: unknown[]
              ) => Promise<unknown>;
              return fn.apply(embedded, args);
            }
            throw err;
          }
        };
      }

      return new Proxy(
        {},
        {
          get(_delTarget, methodProp) {
            return async (...args: unknown[]) => {
              if (useEmbedded || !realClient) {
                const embedded = await getEmbeddedPrisma(embedInMemory);
                const del = Reflect.get(embedded, prop) as object;
                const fn = Reflect.get(del, methodProp) as (
                  ...a: unknown[]
                ) => Promise<unknown>;
                return fn.apply(del, args);
              }
              const realDel = Reflect.get(realClient, prop) as object;
              const realFn = Reflect.get(realDel, methodProp) as (
                ...a: unknown[]
              ) => Promise<unknown>;
              try {
                return await realFn.apply(realDel, args);
              } catch (err) {
                if (isDatabaseOfflineError(err)) {
                  useEmbedded = true;
                  const embedded = await getEmbeddedPrisma(embedInMemory);
                  const del = Reflect.get(embedded, prop) as object;
                  const fn = Reflect.get(del, methodProp) as (
                    ...a: unknown[]
                  ) => Promise<unknown>;
                  return fn.apply(del, args);
                }
                throw err;
              }
            };
          },
        }
      );
    },
  });
}

export const prisma = globalThis.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma;
