/**
 * Application-level mirror of the Prisma `UserRole` enum.
 *
 * Defined here rather than imported from `@prisma/client` so that
 * `tsc --noEmit` works on a fresh clone before `prisma generate` has run.
 * Keep in sync with the `UserRole` enum in `prisma/schema.prisma`.
 */
export type UserRole = "READER" | "EDITOR" | "ADMIN";

export const DEFAULT_ROLE: UserRole = "READER";

export const ALL_ROLES: readonly UserRole[] = ["READER", "EDITOR", "ADMIN"];

const ROLE_RANK: Record<UserRole, number> = {
  READER: 0,
  EDITOR: 1,
  ADMIN: 2,
};

/** True when `actual` meets or exceeds the `required` role in the hierarchy. */
export function hasRole(actual: UserRole, required: UserRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/** Narrow an untrusted string (e.g. from a session token) to a `UserRole`. */
export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && ALL_ROLES.includes(value as UserRole);
}