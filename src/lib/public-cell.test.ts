import { describe, expect, it } from "vitest";
import { publicCellHref } from "./public-cell";

describe("publicCellHref", () => {
  it("pairs a state with federal and hashes the issue slug", () => {
    expect(publicCellHref("TX", "athletics")).toBe("/?j=US,TX#issue-athletics");
  });

  it("uses a second column when the instrument is federal", () => {
    expect(publicCellHref("US", "grievance")).toBe("/?j=US,CA#issue-grievance");
  });

  it("omits the hash when no issue was tagged", () => {
    expect(publicCellHref("CA")).toBe("/?j=US,CA");
  });
});
