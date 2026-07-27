import { describe, expect, test } from "vitest";
import { normaliseLyricsResponse } from "../../src/renderer/lyrics/fetchLyricsElectron.ts";

const SYLLABLE = {
  Type: "Syllable",
  Content: [{ Lead: { StartTime: 12_500, EndTime: 15_000, Syllables: [] } }],
};

describe("normaliseLyricsResponse", () => {
  test("passes through already-shaped Syllable JSON", () => {
    const [content, status] = normaliseLyricsResponse({
      data: SYLLABLE,
      provider: "spicylyrics",
      artworkUrl: null,
    });
    expect(status).toBe(200);
    expect((content as any).Type).toBe("Syllable");
  });

  test("derives StartTime from the first line when the source omits it", () => {
    const [content] = normaliseLyricsResponse({
      data: SYLLABLE,
      provider: "spicylyrics",
      artworkUrl: null,
    });
    expect((content as any).StartTime).toBe(12_500);
  });

  test("derives StartTime for Line-type lyrics", () => {
    const [content] = normaliseLyricsResponse({
      data: { Type: "Line", Content: [{ Text: "a", StartTime: 9_000, EndTime: 11_000 }] },
      provider: "lrclib",
      artworkUrl: null,
    });
    expect((content as any).StartTime).toBe(9_000);
  });

  test("preserves an explicit StartTime", () => {
    const [content] = normaliseLyricsResponse({
      data: { ...SYLLABLE, StartTime: 42 },
      provider: "spicylyrics",
      artworkUrl: null,
    });
    expect((content as any).StartTime).toBe(42);
  });

  test("defaults StartTime to 0 when Content is empty", () => {
    const [content] = normaliseLyricsResponse({
      data: { Type: "Line", Content: [] },
      provider: "genius",
      artworkUrl: null,
    });
    expect((content as any).StartTime).toBe(0);
  });

  test("leaves Static lyrics alone", () => {
    const [content, status] = normaliseLyricsResponse({
      data: { Type: "Static", Lines: [{ Text: "a" }] },
      provider: "genius",
      artworkUrl: null,
    });
    expect(status).toBe(200);
    expect((content as any).Type).toBe("Static");
  });

  test("wraps a single Background object into the array Syllable.ts expects", () => {
    const [content] = normaliseLyricsResponse({
      data: {
        Type: "Syllable",
        Content: [
          {
            Lead: { StartTime: 0, EndTime: 1, Syllables: [] },
            Background: { StartTime: 0, EndTime: 1, Syllables: [] },
          },
        ],
      },
      provider: "spicylyrics",
      artworkUrl: null,
    });
    expect(Array.isArray((content as any).Content[0].Background)).toBe(true);
    expect((content as any).Content[0].Background).toHaveLength(1);
  });

  test("leaves an already-array Background untouched", () => {
    const background = [{ StartTime: 0, EndTime: 1, Syllables: [] }];
    const [content] = normaliseLyricsResponse({
      data: {
        Type: "Syllable",
        Content: [{ Lead: { StartTime: 0, EndTime: 1, Syllables: [] }, Background: background }],
      },
      provider: "spicylyrics",
      artworkUrl: null,
    });
    expect((content as any).Content[0].Background).toEqual(background);
  });

  test("leaves lines with no Background alone", () => {
    const [content] = normaliseLyricsResponse({
      data: { Type: "Syllable", Content: [{ Lead: { StartTime: 0, EndTime: 1, Syllables: [] } }] },
      provider: "spicylyrics",
      artworkUrl: null,
    });
    expect((content as any).Content[0].Background).toBeUndefined();
  });

  test("reports not-found for a null response", () => {
    expect(normaliseLyricsResponse(null)).toEqual(["lyrics-not-found", 404]);
  });

  test("reports not-found when only artwork came back", () => {
    expect(
      normaliseLyricsResponse({ data: null, provider: "apple", artworkUrl: "https://x/a.jpg" }),
    ).toEqual(["lyrics-not-found", 404]);
  });

  test("reports unknown-error for a data object with no Type", () => {
    expect(
      normaliseLyricsResponse({ data: { Content: [] }, provider: "apple", artworkUrl: null }),
    ).toEqual(["unknown-error", 500]);
  });

  test("parses raw TTML if the main process ever returns it unparsed", () => {
    const ttml = `<tt><body><div><p begin="00:10.000" end="00:12.000">Hello</p></div></body></tt>`;
    const [content, status] = normaliseLyricsResponse({
      data: ttml,
      provider: "apple",
      artworkUrl: null,
    });
    expect(status).toBe(200);
    expect((content as any).Type).toBe("Line");
  });

  test("reports unknown-error when raw TTML fails to parse", () => {
    expect(
      normaliseLyricsResponse({ data: "<<<junk", provider: "apple", artworkUrl: null }),
    ).toEqual(["unknown-error", 500]);
  });
});
