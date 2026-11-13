import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signIn, signOut, redirect } = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ signIn, signOut, auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

import { signInWithGoogle, signOutAction } from "./auth-actions";

beforeEach(() => {
  signIn.mockReset();
  signOut.mockReset();
  redirect.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signOutAction", () => {
  it("does not call signOut in local mode", async () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "1");
    await signOutAction();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs out and returns to sign-in in hosted mode", async () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "");
    await signOutAction();
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/sign-in" });
  });
});

describe("signInWithGoogle", () => {
  it("does nothing in local mode, even with Google configured", async () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "1");
    vi.stubEnv("AUTH_GOOGLE_ID", "id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "secret");
    await signInWithGoogle();
    expect(signIn).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("starts Google sign-in in hosted mode", async () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "");
    vi.stubEnv("AUTH_GOOGLE_ID", "id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "secret");
    await signInWithGoogle();
    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/" });
  });

  it("reports a configuration error in hosted mode without Google credentials", async () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "");
    vi.stubEnv("AUTH_GOOGLE_ID", "");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "");
    await expect(signInWithGoogle()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/sign-in?error=Configuration");
    expect(signIn).not.toHaveBeenCalled();
  });
});
