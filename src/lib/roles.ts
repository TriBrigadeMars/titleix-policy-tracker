/**
 * Application-level mirror of the Prisma `UserRole` enum.
 *
 * Defined here rather than imported from `@prisma/client` so that
 * `tsc --noEmit` works on a fresh clone before `prisma generate` has run.
 * Keep in sync with the `UserRole` enum in `prisma/schema.prisma`.
 */
export type UserRole = "READER" | "EDITOR" | "ADMIN";

export const DEFAULT_ROLE: UserRole = "READER";

export const ALL_ROLES = ["READER", "EDITOR", "ADMIN"] as const;

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

/** The slice of a session needed to decide whether the viewer may edit. */
export interface SessionRoleSource {
  user?: { role?: unknown } | null;
}

/**
 * True only when there is a signed-in user holding at least `EDITOR`.
 *
 * Anonymous visitors are explicitly `false` here rather than being assigned
 * `DEFAULT_ROLE` and re-checked, which reads as if a role had been granted.
 * Display-only: every write is authorized by `src/lib/auth-guards.ts`.
 */
export function canEditRole(
  session: SessionRoleSource | null | undefined
): boolean {
  const user = session?.user;
  if (!user) return false;
  return isUserRole(user.role) && hasRole(user.role, "EDITOR");
}