import { describe, expect, it } from "vitest";
import { parseIdList } from "./search-params";

describe("parseIdList", () => {
  it("returns an empty list for a missing param", () => {
    expect(parseIdList(null)).toEqual([]);
  });

  it("returns an empty list for an empty param", () => {
    expect(parseIdList("")).toEqual([]);
  });

  it("splits on commas", () => {
    expect(parseIdList("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims surrounding whitespace", () => {
    expect(parseIdList("  a , b  ")).toEqual(["a", "b"]);
  });

  it("drops empty entries", () => {
    expect(parseIdList("a,,b")).toEqual(["a", "b"]);
    expect(parseIdList(",")).toEqual([]);
    expect(parseIdList("a,")).toEqual(["a"]);
  });

  it("preserves a single value", () => {
    expect(parseIdList("only")).toEqual(["only"]);
  });
});
