import { describe, it, expect } from "vitest";
// @ts-expect-error - main/ is plain JS with no type declarations
import { convertAlignedJsonToTTML } from "../../src/main/lyrics/autoAligner.js";

/** One aligned segment from a list of words, half a second apart. */
function seg(words: string[]) {
  return {
    segments: [
      {
        start: 0,
        end: words.length * 0.5,
        words: words.map((w, i) => ({ word: w, start: i * 0.5, end: i * 0.5 + 0.4 })),
      },
    ],
  };
}

/** Word text out of a run of `<span ...>word </span>` elements. */
function words(html: string) {
  return (html.match(/>([^<>]+)</g) || []).map((s) => s.slice(1, -1).trim()).join(" ").trim();
}

/**
 * The x-bg group is the last element inside the `<p>`, so the capture is greedy
 * to its own closing tag. A non-greedy capture stops at the first inner
 * `</span>` and drops the trailing `<` every word needs to be delimited by.
 */
const BG_RE = /<span ttm:role="x-bg">([\s\S]*)<\/span>/;

/** Text of the lead line — everything not inside an x-bg span. */
function lead(ttml: string) {
  const p = ttml.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
  return words(p.replace(new RegExp(BG_RE.source + "$"), ""));
}

function background(ttml: string) {
  return words(ttml.match(BG_RE)?.[1] ?? "");
}

describe("convertAlignedJsonToTTML ad-lib classification", () => {
  it("keeps an interjection word that is part of a real line in the lead", () => {
    const ttml = convertAlignedJsonToTTML(seg(["going", "to", "pop", "the", "top"]));
    expect(lead(ttml)).toBe("going to pop the top");
    expect(background(ttml)).toBe("");
  });

  it("treats a parenthesised word as background wherever it appears", () => {
    const ttml = convertAlignedJsonToTTML(seg(["run", "it", "(yeah)", "back"]));
    expect(lead(ttml)).toBe("run it back");
    expect(background(ttml)).toBe("yeah");
  });

  it("still classifies a whole line that is only an interjection as an ad-lib", () => {
    // It is emitted as a plain <p> rather than an x-bg group: there is no lead
    // for it to sit under (autoAligner.js:125-130), and ttmlXml.js:206-208
    // promotes a background-only paragraph back to a lead anyway. What matters
    // is that the line survives with its word intact.
    const ttml = convertAlignedJsonToTTML(seg(["Yeah"]));
    expect(lead(ttml)).toBe("Yeah");
    expect(background(ttml)).toBe("");
  });

  it("still treats a parenthesised ad-lib inside a lone-word line as background", () => {
    const ttml = convertAlignedJsonToTTML(seg(["(Wow)"]));
    expect(lead(ttml)).toBe("Wow");
  });

  it("keeps a multi-word line of ordinary words entirely in the lead", () => {
    const ttml = convertAlignedJsonToTTML(seg(["gang", "gang", "on", "the", "block"]));
    expect(lead(ttml)).toBe("gang gang on the block");
    expect(background(ttml)).toBe("");
  });
});
