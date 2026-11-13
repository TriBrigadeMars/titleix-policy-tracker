import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, redirect } = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ auth, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

import SignInPage from "./page";

const noParams = () => ({ searchParams: Promise.resolve({}) });

beforeEach(() => {
  auth.mockReset();
  auth.mockResolvedValue(null);
  redirect.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SignInPage", () => {
  it("redirects to / in local mode", async () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "1");
    await expect(SignInPage(noParams())).rejects.toThrow("NEXT_REDIRECT /");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("renders the sign-in card in hosted mode when signed out", async () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "");
    const tree = await SignInPage(noParams());
    expect(tree).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("still redirects signed-in users to / in hosted mode", async () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "");
    auth.mockResolvedValue({ user: { id: "u1", role: "READER" } });
    await expect(SignInPage(noParams())).rejects.toThrow("NEXT_REDIRECT /");
  });
});
