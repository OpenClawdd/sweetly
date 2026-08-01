/**
 * Source precedence in the provider chain.
 *
 * The chain is documented as custom -> apple -> binilyrics -> spicylyrics ->
 * lrclib -> genius, and the first step is the one that matters most: a file in
 * ~/.sweetly-custom was put there deliberately, usually force-aligned against
 * the actual audio, so it encodes an intent no provider can infer.
 *
 * That order was once inverted so Apple's word-level TTML won, which silently
 * ignored every locally aligned track for which Apple also had word timings —
 * with no error and no log line saying the custom file had been skipped. These
 * tests pin the precedence so it cannot invert quietly again.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const getCustomLyrics = vi.fn();
const findAppleMusicLyrics = vi.fn();
const fetchBiniLyrics = vi.fn();
const fetchITunesArtwork = vi.fn();

vi.mock("../../src/main/lyrics/sources/custom.js", () => ({
  getCustomLyrics: (...a: unknown[]) => getCustomLyrics(...a),
}));
vi.mock("../../src/main/appleMusicApi.js", () => ({
  findAppleMusicLyrics: (...a: unknown[]) => findAppleMusicLyrics(...a),
  fetchITunesArtwork: (...a: unknown[]) => fetchITunesArtwork(...a),
}));
vi.mock("../../src/main/lyrics/sources/binilyrics.js", () => ({
  fetchBiniLyrics: (...a: unknown[]) => fetchBiniLyrics(...a),
}));
vi.mock("../../src/main/lyrics/sources/lrclib.js", () => ({ fetchLRCLib: vi.fn() }));
vi.mock("../../src/main/lyrics/sources/genius.js", () => ({ fetchGenius: vi.fn() }));
vi.mock("../../src/main/lyrics/sources/spotify.js", () => ({
  scrapeSpotifySearch: vi.fn(),
  fetchSpicyLyricsData: vi.fn(),
}));

const { fetchLyricsData } = await import("../../src/main/lyrics/fetcher.js");

/** Minimal Spicy-shaped payload with the given timing granularity. */
function lyrics(timing: string) {
  return { Type: "Syllable", Timing: timing, Content: [{ Text: "a" }, { Text: "b" }] };
}

describe("provider precedence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchITunesArtwork.mockResolvedValue(null);
    fetchBiniLyrics.mockResolvedValue(null);
  });

  test("a custom file wins over Apple Music word-level TTML", async () => {
    getCustomLyrics.mockResolvedValue(lyrics("word"));
    findAppleMusicLyrics.mockResolvedValue({ lyrics: lyrics("word"), artworkUrl: "art" });

    const result = await fetchLyricsData("Song One", "Artist", "Album", {});

    expect(result.provider).toBe("spicylyrics");
    expect(result.data.IsCommunity).toBe(true);
  });

  test("Apple Music word-level TTML is used when there is no custom file", async () => {
    getCustomLyrics.mockResolvedValue(null);
    findAppleMusicLyrics.mockResolvedValue({ lyrics: lyrics("word"), artworkUrl: "art" });

    const result = await fetchLyricsData("Song Two", "Artist", "Album", {});

    expect(result.provider).toBe("apple");
    expect(result.data.Provider).toBe("Apple Music");
  });

  test("Apple line-level TTML does not pre-empt the community sources", async () => {
    getCustomLyrics.mockResolvedValue(null);
    findAppleMusicLyrics.mockResolvedValue({ lyrics: lyrics("line"), artworkUrl: null });
    fetchBiniLyrics.mockResolvedValue(lyrics("word"));

    const result = await fetchLyricsData("Song Three", "Artist", "Album", {});

    expect(result.provider).toBe("spicylyrics");
  });

  test("the custom file is consulted even when Apple Music lookup throws", async () => {
    getCustomLyrics.mockResolvedValue(lyrics("word"));
    findAppleMusicLyrics.mockRejectedValue(new Error("no media-user-token"));

    const result = await fetchLyricsData("Song Four", "Artist", "Album", {});

    expect(result.provider).toBe("spicylyrics");
  });
});
