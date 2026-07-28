import { describe, it, expect } from "vitest";
// @ts-expect-error - main/ is plain JS with no type declarations
import { isCensored, pickAlignmentText } from "../../src/main/lyrics/utils.js";

describe("isCensored", () => {
  it("detects runs of two or more asterisks", () => {
    expect(isCensored("these **** here")).toBe(true);
    expect(isCensored("a ** b")).toBe(true);
  });

  it("does not flag ordinary text or a lone asterisk", () => {
    expect(isCensored("nothing masked here")).toBe(false);
    expect(isCensored("5 * 3 = 15")).toBe(false);
    expect(isCensored("")).toBe(false);
    expect(isCensored(null)).toBe(false);
  });
});

describe("pickAlignmentText", () => {
  it("prefers an uncensored candidate over a censored one", () => {
    const got = pickAlignmentText([
      { source: "apple", text: "these **** here" },
      { source: "lrclib", text: "these words here" },
    ]);
    expect(got?.source).toBe("lrclib");
  });

  it("keeps source order when neither is censored", () => {
    const got = pickAlignmentText([
      { source: "apple", text: "clean one" },
      { source: "lrclib", text: "clean two" },
    ]);
    expect(got?.source).toBe("apple");
  });

  it("falls back to the least-masked candidate when all are censored", () => {
    const got = pickAlignmentText([
      { source: "apple", text: "**** and **** and ****" },
      { source: "lrclib", text: "**** only once" },
    ]);
    expect(got?.source).toBe("lrclib");
  });

  it("ignores empty and whitespace-only candidates", () => {
    const got = pickAlignmentText([
      { source: "apple", text: "" },
      { source: "genius", text: "   \n  " },
      { source: "lrclib", text: "real text" },
    ]);
    expect(got?.source).toBe("lrclib");
  });

  it("returns null when there is nothing usable", () => {
    expect(pickAlignmentText([])).toBe(null);
    expect(pickAlignmentText([{ source: "apple", text: "" }])).toBe(null);
    expect(pickAlignmentText(null)).toBe(null);
  });
});
