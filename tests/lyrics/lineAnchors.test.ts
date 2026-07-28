import { describe, it, expect } from "vitest";
// @ts-expect-error - main/ is plain JS with no type declarations
import { toLineAnchors } from "../../src/main/lyrics/utils.js";

function line(words: string[], start: number, end: number) {
  return {
    Lead: {
      StartTime: start,
      EndTime: end,
      Syllables: words.map((w, i) => ({
        Text: w,
        StartTime: start + i * 0.1,
        EndTime: start + i * 0.1 + 0.09,
      })),
    },
  };
}

describe("toLineAnchors", () => {
  it("returns one anchor per line, with reconstructed text", () => {
    const data = { Type: "Syllable", Content: [line(["one", "two"], 1, 3), line(["three"], 3, 5)] };
    expect(toLineAnchors(data)).toEqual([
      { text: "one two", start: 1, end: 3 },
      { text: "three", start: 3, end: 5 },
    ]);
  });

  it("drops lines with no usable window", () => {
    const data = {
      Type: "Syllable",
      Content: [line(["ok"], 1, 3), line(["bad"], 5, 5), line(["worse"], 9, 8)],
    };
    expect(toLineAnchors(data).map((a: any) => a.text)).toEqual(["ok"]);
  });

  it("drops lines with no text", () => {
    const data = { Type: "Syllable", Content: [line([], 1, 3), line(["kept"], 3, 5)] };
    expect(toLineAnchors(data).map((a: any) => a.text)).toEqual(["kept"]);
  });

  it("returns nothing for unsynced or empty input", () => {
    expect(toLineAnchors({ Content: [line(["a"], 1, 2)], Unsynced: true })).toEqual([]);
    expect(toLineAnchors({ Content: [] })).toEqual([]);
    expect(toLineAnchors(null)).toEqual([]);
  });
});
