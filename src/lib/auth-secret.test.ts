import { describe, expect, it } from "vitest";
import {
  DEV_ONLY_AUTH_SECRET,
  MISSING_AUTH_SECRET_MESSAGE,
  resolveAuthSecret,
} from "./auth-secret";

describe("resolveAuthSecret", () => {
  it("returns the provided secret unchanged in every environment", () => {
    for (const nodeEnv of ["production", "development", "test", undefined]) {
      expect(
        resolveAuthSecret({ authSecret: "real-secret", nodeEnv }),
      ).toBe("real-secret");
    }
  });

  it("does not trim a provided secret", () => {
    expect(
      resolveAuthSecret({ authSecret: " padded secret ", nodeEnv: "production" }),
    ).toBe(" padded secret ");
  });

  it("treats an empty or whitespace-only secret as unset", () => {
    for (const authSecret of ["", "   ", "\n\t"]) {
      expect(resolveAuthSecret({ authSecret, nodeEnv: "development" })).toBe(
        DEV_ONLY_AUTH_SECRET,
      );
      expect(() =>
        resolveAuthSecret({ authSecret, nodeEnv: "production" }),
      ).toThrow(MISSING_AUTH_SECRET_MESSAGE);
    }
  });

  it("returns the dev fallback in development and test", () => {
    expect(resolveAuthSecret({ nodeEnv: "development" })).toBe(
      DEV_ONLY_AUTH_SECRET,
    );
    expect(resolveAuthSecret({ nodeEnv: "test" })).toBe(DEV_ONLY_AUTH_SECRET);
  });

  it("returns the dev fallback during the production build phase", () => {
    expect(
      resolveAuthSecret({
        nodeEnv: "production",
        nextPhase: "phase-production-build",
      }),
    ).toBe(DEV_ONLY_AUTH_SECRET);
  });

  it("throws in production at runtime when no secret is set", () => {
    expect(() => resolveAuthSecret({ nodeEnv: "production" })).toThrow(
      "AUTH_SECRET is not set. Refusing to start in production without it.",
    );
    expect(() =>
      resolveAuthSecret({
        authSecret: undefined,
        nodeEnv: "production",
        nextPhase: "phase-production-server",
      }),
    ).toThrow(MISSING_AUTH_SECRET_MESSAGE);
  });
});
