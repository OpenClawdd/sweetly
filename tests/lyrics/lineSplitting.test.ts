import { describe, it, expect } from "vitest";
// @ts-expect-error - main/ is plain JS with no type declarations
import { parseTtmlXmlToJson } from "../../src/main/lyrics/ttmlXml.js";

const LINE_LEVEL = `<tt xmlns="http://www.w3.org/ns/ttml" itunes:timing="Line" xml:lang="en">
<body dur="00:00:10.000"><div>
<p begin="00:00:01.000" end="00:00:05.000">one two three four</p>
</div></body></tt>`;

describe("line-level TTML", () => {
  it("splits a line into per-word syllables by default", () => {
    const parsed = parseTtmlXmlToJson(LINE_LEVEL, { forceWordLevel: true });
    const syllables = parsed.Content[0].Lead.Syllables;
    expect(syllables.map((s: any) => s.Text)).toEqual(["one", "two", "three", "four"]);
  });

  it("does not split when forceWordLevel is false", () => {
    const parsed = parseTtmlXmlToJson(LINE_LEVEL, { forceWordLevel: false });
    const syllables = parsed.Content[0].Lead.Syllables;
    expect(syllables.map((s: any) => s.Text)).toEqual(["one two three four"]);
  });

  it("spreads the word timings across the line's own span", () => {
    const parsed = parseTtmlXmlToJson(LINE_LEVEL, { forceWordLevel: true });
    const syllables = parsed.Content[0].Lead.Syllables;
    expect(syllables[0].StartTime).toBeCloseTo(1.0, 3);
    expect(syllables[3].EndTime).toBeCloseTo(5.0, 3);
    for (let i = 1; i < syllables.length; i++) {
      expect(syllables[i].StartTime).toBeGreaterThanOrEqual(syllables[i - 1].EndTime - 1e-6);
    }
  });

  it("keeps the line's own start and end untouched", () => {
    const parsed = parseTtmlXmlToJson(LINE_LEVEL);
    expect(parsed.Content[0].Lead.StartTime).toBeCloseTo(1.0, 3);
    expect(parsed.Content[0].Lead.EndTime).toBeCloseTo(5.0, 3);
  });
});
