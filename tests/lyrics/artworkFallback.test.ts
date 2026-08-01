import { describe, expect, test, vi } from "vitest";
import { fetchITunesArtwork } from "../../src/main/appleMusicApi.js";

describe("fetchITunesArtwork", () => {
  test("fetches high-resolution artwork from iTunes search API", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        results: [
          { artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg" },
        ],
      }),
    };
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse) as any;

    try {
      const art = await fetchITunesArtwork("Hot N' Cold", "yit");
      expect(art).toBe("https://is1-ssl.mzstatic.com/image/thumb/Music/600x600bb.jpg");
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  test("returns null when search term is empty or fetch fails", async () => {
    const artEmpty = await fetchITunesArtwork("", "");
    expect(artEmpty).toBeNull();
  });
});
