import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, signIn, signOut } = vi.hoisted(() => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth, signIn, signOut }));

import type { ReactElement, ReactNode } from "react";
import { signOutAction } from "@/app/auth-actions";
import { SiteHeader } from "./site-header";

const ADMIN_SESSION = {
  user: {
    id: "local-admin",
    role: "ADMIN",
    name: "Local Admin",
    email: "local@example.com",
    image: null,
  },
};

/** Every element in a rendered tree, depth first. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node == null || typeof node !== "object" || !("type" in node)) return [];
  const element = node as ReactElement;
  const props = element.props as { children?: ReactNode };
  return [element, ...elements(props.children)];
}

/** All string and number children in a rendered tree, joined. */
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (node == null || typeof node !== "object" || !("props" in node)) return "";
  return text((node as ReactElement<{ children?: ReactNode }>).props.children);
}

function forms(tree: ReactNode): ReactElement<{ action?: unknown }>[] {
  return elements(tree).filter(
    (el): el is ReactElement<{ action?: unknown }> => el.type === "form"
  );
}

beforeEach(() => {
  auth.mockReset();
  auth.mockResolvedValue(ADMIN_SESSION);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SiteHeader", () => {
  it("renders a sign-out form in hosted mode", async () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "");
    const tree = await SiteHeader();

    const signOutForms = forms(tree);
    expect(signOutForms).toHaveLength(1);
    expect(signOutForms[0].props.action).toBe(signOutAction);
    expect(text(tree)).toContain("Sign out");
    expect(text(tree)).not.toContain("Local mode");
  });

  it("renders the user name and a Local mode badge, and no sign-out form, in local mode", async () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "1");
    const tree = await SiteHeader();

    expect(forms(tree)).toHaveLength(0);
    expect(text(tree)).not.toContain("Sign out");
    expect(text(tree)).toContain("Local Admin");
    expect(text(tree)).toContain("Local mode");
  });

  it("offers no sign-in link in local mode when the session is missing", async () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "1");
    auth.mockResolvedValue(null);
    const tree = await SiteHeader();

    const hrefs = elements(tree).map(
      (el) => (el.props as { href?: unknown }).href
    );
    expect(hrefs).not.toContain("/sign-in");
    expect(text(tree)).toContain("Local mode");
  });

  it("still links to sign-in in hosted mode when signed out", async () => {
    vi.stubEnv("TITLEIX_LOCAL_MODE", "");
    auth.mockResolvedValue(null);
    const tree = await SiteHeader();

    const hrefs = elements(tree).map(
      (el) => (el.props as { href?: unknown }).href
    );
    expect(hrefs).toContain("/sign-in");
    expect(forms(tree)).toHaveLength(0);
  });
});
