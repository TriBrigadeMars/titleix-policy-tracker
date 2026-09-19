import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getJurisdictions, getHeatmapSummaries, getIssueTags } =
  vi.hoisted(() => ({
    auth: vi.fn(),
    getJurisdictions: vi.fn(),
    getHeatmapSummaries: vi.fn(),
    getIssueTags: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/queries", () => ({
  getJurisdictions,
  getHeatmapSummaries,
  getIssueTags,
  getInstrumentsForComparison: vi.fn(async () => []),
  getCellNotesForComparison: vi.fn(async () => []),
}));

import type { ReactElement, ReactNode } from "react";
import { Dashboard } from "@/components/dashboard";
import { PublicReadOnlyNote } from "@/components/public-readonly-note";
import { StateHeatmap } from "@/components/state-heatmap";
import Home from "./page";
import HeatmapPage from "./heatmap/page";

const EDITOR_SESSION = {
  user: {
    id: "editor-1",
    role: "EDITOR",
    name: "Ed",
    email: "ed@example.com",
    image: null,
  },
};

const READER_SESSION = {
  user: {
    id: "reader-1",
    role: "READER",
    name: "Rea",
    email: "rea@example.com",
    image: null,
  },
};

/** Walk a rendered element tree looking for the first element of `type`. */
function findByType(node: ReactNode, type: unknown): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByType(child, type);
      if (found) return found;
    }
    return null;
  }
  if (node == null || typeof node !== "object" || !("type" in node)) {
    return null;
  }
  const element = node as ReactElement;
  if (element.type === type) return element;

  const props = element.props as { children?: ReactNode };
  return props.children === undefined
    ? null
    : findByType(props.children, type);
}

/** The `canEdit` prop handed to `Dashboard`, or `undefined` if not rendered. */
function canEditProp(tree: ReactNode): unknown {
  const dashboard = findByType(tree, Dashboard);
  if (!dashboard) return undefined;
  return (dashboard.props as { canEdit?: unknown }).canEdit;
}

describe("public comparison matrix page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getJurisdictions.mockResolvedValue([]);
    getIssueTags.mockResolvedValue([]);
  });

  it("renders the matrix read-only with no session", async () => {
    auth.mockResolvedValue(null);

    const tree = await Home({ searchParams: Promise.resolve({}) });

    expect(findByType(tree, Dashboard)).not.toBeNull();
    expect(canEditProp(tree)).toBe(false);
    // No session means no fabricated role and no editor chrome.
    expect(findByType(tree, PublicReadOnlyNote)).not.toBeNull();
  });

  it("renders the matrix read-only for a signed-in READER", async () => {
    auth.mockResolvedValue(READER_SESSION);

    const tree = await Home({ searchParams: Promise.resolve({}) });

    expect(canEditProp(tree)).toBe(false);
  });

  it("enables editing for a signed-in EDITOR", async () => {
    auth.mockResolvedValue(EDITOR_SESSION);

    const tree = await Home({ searchParams: Promise.resolve({}) });

    expect(canEditProp(tree)).toBe(true);
    expect(findByType(tree, PublicReadOnlyNote)).toBeNull();
  });
});

describe("public heatmap page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHeatmapSummaries.mockResolvedValue([]);
  });

  it("still renders the heatmap with no session", async () => {
    auth.mockResolvedValue(null);

    const tree = await HeatmapPage();

    expect(findByType(tree, StateHeatmap)).not.toBeNull();
    expect(findByType(tree, PublicReadOnlyNote)).not.toBeNull();
  });

  it("hides the public note for a signed-in user", async () => {
    auth.mockResolvedValue(EDITOR_SESSION);

    const tree = await HeatmapPage();

    expect(findByType(tree, StateHeatmap)).not.toBeNull();
    expect(findByType(tree, PublicReadOnlyNote)).toBeNull();
  });
});
