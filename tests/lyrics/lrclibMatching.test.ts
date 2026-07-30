import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchLRCLib, clearLRCLibCache } from "../../src/main/lyrics/sources/lrclib.js";

const SYNCED = "[00:12.00] line one\n[00:15.50] line two\n[00:19.00] line three";

function mockSearch(results: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => results })),
  );
}

afterEach(() => {
  clearLRCLibCache();
  vi.unstubAllGlobals();
});

describe("fetchLRCLib track matching", () => {
  it("prefers a synced entry over a better-titled unsynced one", async () => {
    // Mirrors the real payload for Kid Rock — "Cool, Daddy Cool". The exact-artist
    // unsynced rows outscored the synced row 120 to 110.
    mockSearch([
      {
        trackName: 'Cool, Daddy Cool (From "Osmosis Jones") (feat. Joe C.)',
        artistName: "Kid Rock",
        duration: 199,
        plainLyrics: "plain text only",
        syncedLyrics: null,
      },
      {
        trackName: 'Cool, Daddy Cool (From "Osmosis Jones") [feat. Joe C.]',
        artistName: "Kid Rock",
        duration: 198,
        plainLyrics: "plain text only",
        syncedLyrics: null,
      },
      {
        trackName: "Cool Daddy Cool feat. Joe C",
        artistName: "Kid Rock/Joe C.",
        duration: 200,
        plainLyrics: "plain text",
        syncedLyrics: SYNCED,
      },
    ]);

    const result = await fetchLRCLib("Cool, Daddy Cool", "Kid Rock");

    expect(result).not.toBeNull();
    expect(result?.Content).toHaveLength(3);
    expect(result?.Content?.[0]?.Lead?.StartTime).toBeCloseTo(12, 2);
  });

  it("still returns null when no candidate has synced lyrics", async () => {
    mockSearch([
      { trackName: "Some Song", artistName: "Some Artist", plainLyrics: "words", syncedLyrics: null },
    ]);

    expect(await fetchLRCLib("Some Song", "Some Artist")).toBeNull();
  });

  it("does not match an unrelated track that happens to be synced", async () => {
    mockSearch([
      { trackName: "Entirely Different Song", artistName: "Nobody At All", plainLyrics: "x", syncedLyrics: SYNCED },
    ]);

    expect(await fetchLRCLib("Cool, Daddy Cool", "Kid Rock")).toBeNull();
  });
});
