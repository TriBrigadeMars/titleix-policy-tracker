import { describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  DEFAULT_ROLE,
  hasRole,
  isUserRole,
  type UserRole,
} from "./roles";

describe("hasRole", () => {
  it("treats a role as satisfying itself", () => {
    for (const role of ALL_ROLES) {
      expect(hasRole(role, role)).toBe(true);
    }
  });

  it("orders READER < EDITOR < ADMIN", () => {
    expect(hasRole("READER", "EDITOR")).toBe(false);
    expect(hasRole("READER", "ADMIN")).toBe(false);
    expect(hasRole("EDITOR", "READER")).toBe(true);
    expect(hasRole("EDITOR", "ADMIN")).toBe(false);
    expect(hasRole("ADMIN", "READER")).toBe(true);
    expect(hasRole("ADMIN", "EDITOR")).toBe(true);
  });

  it("fails closed for a role outside the hierarchy", () => {
    // Guards against a value slipping through from an untyped session.
    expect(hasRole("SUPERADMIN" as UserRole, "READER")).toBe(false);
    expect(hasRole("" as UserRole, "READER")).toBe(false);
  });
});

describe("isUserRole", () => {
  it("accepts every known role", () => {
    for (const role of ALL_ROLES) {
      expect(isUserRole(role)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const value of [
      "SUPERADMIN",
      "reader",
      "",
      null,
      undefined,
      0,
      42,
      {},
      [],
      true,
    ]) {
      expect(isUserRole(value)).toBe(false);
    }
  });
});

describe("role constants", () => {
  it("defaults new users to READER", () => {
    expect(DEFAULT_ROLE).toBe("READER");
  });

  it("lists roles in ascending privilege order", () => {
    expect([...ALL_ROLES]).toEqual(["READER", "EDITOR", "ADMIN"]);
  });
});
