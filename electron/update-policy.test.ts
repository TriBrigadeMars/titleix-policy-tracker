import { describe, expect, it, vi } from "vitest";
import * as yaml from "js-yaml";
import {
  DEFAULT_UPDATE_CHANNEL,
  describeSkipReason,
  normalisePublisherNames,
  parseUpdateConfig,
  planUpdate,
  shouldOfferUpdate,
  type UpdateConfigParse,
  type UpdateSkipReason,
} from "./update-policy";

const parse = (text: string) => yaml.load(text);

/** Semver-like comparison good enough to exercise the boundary cases. */
function compareVersions(a: string, b: string): number {
  const toParts = (value: string) =>
    value.split("-")[0].split(".").map((part) => Number.parseInt(part, 10));
  const left = toParts(a);
  const right = toParts(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

describe("normalisePublisherNames", () => {
  it.each([
    { name: "a single string", input: "CN=Example", expected: ["CN=Example"] },
    { name: "a trimmed string", input: "  CN=Example  ", expected: ["CN=Example"] },
    { name: "an array", input: ["A", "B"], expected: ["A", "B"] },
    { name: "an array with blanks", input: ["A", "  ", ""], expected: ["A"] },
    { name: "an empty string", input: "", expected: [] },
    { name: "a whitespace string", input: "   ", expected: [] },
    { name: "a number", input: 42, expected: [] },
    { name: "null", input: null, expected: [] },
    { name: "undefined", input: undefined, expected: [] },
    { name: "an object", input: { a: 1 }, expected: [] },
  ])("handles $name", ({ input, expected }) => {
    expect(normalisePublisherNames(input)).toEqual(expected);
  });
});

describe("parseUpdateConfig", () => {
  it("parses a github config", () => {
    const result = parseUpdateConfig(
      "provider: github\npublisherName: CN=Example\nchannel: latest\n",
      parse,
    );
    expect(result).toEqual({
      kind: "OK",
      config: { provider: "github", publisherName: "CN=Example", channel: "latest" },
    });
  });

  it("parses a generic config with a url", () => {
    const result = parseUpdateConfig(
      "provider: generic\nurl: https://example.test/feed\npublisherName: CN=Example\n",
      parse,
    );
    expect(result).toEqual({
      kind: "OK",
      config: {
        provider: "generic",
        url: "https://example.test/feed",
        publisherName: "CN=Example",
      },
    });
  });

  it("drops blank channel and url rather than passing them through", () => {
    const result = parseUpdateConfig(
      "provider: github\npublisherName: CN=Example\nchannel: '   '\nurl: ''\n",
      parse,
    );
    expect(result).toEqual({
      kind: "OK",
      config: { provider: "github", publisherName: "CN=Example" },
    });
  });

  it.each([
    { name: "null", input: null, reason: "config-missing" },
    { name: "undefined", input: undefined, reason: "config-missing" },
    { name: "empty", input: "", reason: "config-missing" },
    { name: "whitespace", input: "   \n  ", reason: "config-missing" },
  ])("skips $name as $reason", ({ input, reason }) => {
    expect(parseUpdateConfig(input, parse)).toEqual({ kind: "SKIP", reason });
  });

  it("skips unparseable yaml as config-unreadable", () => {
    const boom = vi.fn(() => {
      throw new Error("bad yaml");
    });
    expect(parseUpdateConfig("provider: [", boom)).toEqual({
      kind: "SKIP",
      reason: "config-unreadable",
    });
  });

  it.each([
    { name: "a scalar", input: "just-a-string\n" },
    { name: "a number", input: "42\n" },
    { name: "an array", input: "- a\n- b\n" },
    { name: "null document", input: "null\n" },
    { name: "an object without provider", input: "publisherName: CN=Example\n" },
    { name: "a blank provider", input: "provider: '  '\n" },
  ])("skips $name as config-invalid", ({ input }) => {
    expect(parseUpdateConfig(input, parse)).toEqual({
      kind: "SKIP",
      reason: "config-invalid",
    });
  });
});

describe("planUpdate", () => {
  const okConfig = (body: string): UpdateConfigParse =>
    parseUpdateConfig(body, parse);

  it("disables updates for a development build", () => {
    const plan = planUpdate(false, { kind: "SKIP", reason: "config-missing" });
    expect(plan).toEqual({
      enabled: false,
      reason: "not-packaged",
      publisherNames: [],
    });
  });

  it("reports not-packaged even when a config happens to parse", () => {
    const plan = planUpdate(false, okConfig("provider: github\npublisherName: CN=X\n"));
    expect(plan.enabled).toBe(false);
    expect(plan.reason).toBe("not-packaged");
  });

  /**
   * The core WP-15A rule 4 gate. electron-updater treats a missing
   * publisherName as a *successful* signature verification, so a config
   * without one must never enable the updater.
   */
  it.each([
    { name: "absent", body: "provider: github\n" },
    { name: "empty string", body: "provider: github\npublisherName: ''\n" },
    { name: "whitespace only", body: "provider: github\npublisherName: '   '\n" },
    { name: "empty array", body: "provider: github\npublisherName: []\n" },
    { name: "array of blanks", body: "provider: github\npublisherName: ['', '  ']\n" },
  ])("refuses to enable updates when publisherName is $name", ({ body }) => {
    const plan = planUpdate(true, okConfig(body));
    expect(plan.enabled).toBe(false);
    expect(plan.reason).toBe("publisher-name-missing");
    expect(plan.publisherNames).toEqual([]);
  });

  it("carries skip reasons from the parse through unchanged", () => {
    const plan = planUpdate(true, { kind: "SKIP", reason: "config-invalid" });
    expect(plan).toEqual({
      enabled: false,
      reason: "config-invalid",
      publisherNames: [],
    });
  });

  it("enables a github feed and applies the default channel", () => {
    const plan = planUpdate(true, okConfig("provider: github\npublisherName: CN=X\n"));
    expect(plan).toEqual({
      enabled: true,
      publisherNames: ["CN=X"],
      channel: DEFAULT_UPDATE_CHANNEL,
    });
  });

  it("honours an explicit channel", () => {
    const plan = planUpdate(
      true,
      okConfig("provider: github\npublisherName: CN=X\nchannel: beta\n"),
    );
    expect(plan.channel).toBe("beta");
  });

  it.each([
    { name: "upper case", provider: "GitHub" },
    { name: "surrounding whitespace", provider: "  github  " },
  ])("normalises a $name provider", ({ provider }) => {
    const plan = planUpdate(
      true,
      okConfig(`provider: "${provider}"\npublisherName: CN=X\n`),
    );
    expect(plan.enabled).toBe(true);
  });

  it("enables a generic feed only when it declares a url", () => {
    const withUrl = planUpdate(
      true,
      okConfig(
        "provider: generic\nurl: https://example.test/feed\npublisherName: CN=X\n",
      ),
    );
    expect(withUrl.enabled).toBe(true);
  });

  it("refuses a generic feed with no url", () => {
    const plan = planUpdate(
      true,
      okConfig("provider: generic\npublisherName: CN=X\n"),
    );
    expect(plan.enabled).toBe(false);
    expect(plan.reason).toBe("feed-url-missing");
  });

  it("refuses an unsupported provider", () => {
    const plan = planUpdate(
      true,
      okConfig("provider: s3\npublisherName: CN=X\n"),
    );
    expect(plan.enabled).toBe(false);
    expect(plan.reason).toBe("provider-unsupported");
  });

  it.each([
    { name: "multiple names", body: "provider: github\npublisherName: [A, B]\n", expected: ["A", "B"] },
    { name: "a single name", body: "provider: github\npublisherName: A\n", expected: ["A"] },
  ])("returns all publisher names for $name", ({ body, expected }) => {
    const plan = planUpdate(true, okConfig(body));
    expect(plan.publisherNames).toEqual(expected);
  });

  it("never throws for any skip reason", () => {
    const reasons: UpdateSkipReason[] = [
      "not-packaged",
      "config-missing",
      "config-unreadable",
      "config-invalid",
      "publisher-name-missing",
      "provider-unsupported",
      "feed-url-missing",
            "signature-verification-unsupported",
          ];
    for (const reason of reasons) {
      expect(() => describeSkipReason(reason)).not.toThrow();
      expect(describeSkipReason(reason).length).toBeGreaterThan(0);
    }
  });
});

describe("shouldOfferUpdate", () => {
  it.each([
    { name: "a newer patch", current: "1.0.0", candidate: "1.0.1", expected: true },
    { name: "a newer minor", current: "1.0.0", candidate: "1.1.0", expected: true },
    { name: "a newer major", current: "1.0.0", candidate: "2.0.0", expected: true },
    { name: "the same version", current: "1.0.0", candidate: "1.0.0", expected: false },
    { name: "an older version", current: "1.0.1", candidate: "1.0.0", expected: false },
    { name: "a much older version", current: "2.0.0", candidate: "1.0.0", expected: false },
  ])("returns $expected for $name", ({ current, candidate, expected }) => {
    expect(shouldOfferUpdate(current, candidate, compareVersions)).toBe(expected);
  });

  it.each([
    { name: "an empty current", current: "", candidate: "1.0.0", expected: false },
        { name: "an empty candidate", current: "1.0.0", candidate: "", expected: false },
        { name: "whitespace", current: "1.0.0", candidate: "   ", expected: false },
      ])("refuses when $name is given", ({ current, candidate, expected }) => {
        expect(shouldOfferUpdate(current, candidate, compareVersions)).toBe(expected);
  });

  it("refuses rather than guesses when the comparator throws", () => {
    const explosion = () => {
      throw new Error("unparseable");
    };
    expect(shouldOfferUpdate("not-a-version", "also-not", explosion)).toBe(false);
  });
});