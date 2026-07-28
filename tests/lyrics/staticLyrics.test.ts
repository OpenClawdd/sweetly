import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Apple serves some tracks as itunes:timing="None" — plain text, no timestamps.
 * ttmlXml.js emits those as { Type: "Static", Content: [...], Unsynced: true },
 * but upstream's ApplyStaticLyrics (Static.ts:63) reads `data.Lines`, not
 * `Content`. So `data.Lines.some(...)` threw:
 *
 *   TypeError: Cannot read properties of undefined (reading 'some')
 *
 * That throw is not confined to the offending track. ApplyLyrics calls
 * DestroyAllLyricsContainers() *before* it builds, so the throw left a detached
 * container behind; every later apply then died in cleanup with
 * "Failed to execute 'unobserve' on 'ResizeObserver'" and rendered nothing.
 * One unsynced song blanked every song played after it.
 */

const fetchLyrics = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchLyrics.mockReset();
  (globalThis as any).electronAPI = { fetchLyrics };
});

async function fetchWith(data: unknown) {
  fetchLyrics.mockResolvedValue({ data, provider: "apple", artworkUrl: null });
  const mod = await import("../../src/renderer/lyrics/fetchLyricsElectron.ts");
  const { setMusicStateForTest } = await import("../../src/renderer/adapter/musicState.ts");
  setMusicStateForTest({
    status: "playing",
    track: {
      name: "T", nameCleaned: "T", artist: "A", artistCleaned: "A",
      album: "Al", duration: 100, position: 0,
    },
    shuffle: false, repeat: "off",
  } as any);
  return mod.fetchLyricsForCurrentTrack();
}

const staticPayload = {
  Type: "Static",
  Unsynced: true,
  Content: [
    { Lead: { Syllables: [{ Text: "alpha" }, { Text: "bravo" }] } },
    { Lead: { Syllables: [{ Text: "charlie" }] } },
  ],
};

describe("static (unsynced) lyrics shaping", () => {
  it("supplies the Lines array ApplyStaticLyrics requires", async () => {
    const [content] = await fetchWith(staticPayload);

    expect(typeof content).toBe("object");
    const lines = (content as any).Lines;
    expect(Array.isArray(lines)).toBe(true);
    expect(lines).toHaveLength(2);
  });

  it("joins syllables into readable line text", async () => {
    const [content] = await fetchWith(staticPayload);

    expect((content as any).Lines[0].Text).toBe("alpha bravo");
    expect((content as any).Lines[1].Text).toBe("charlie");
  });

  it("does not put a space before a mid-word syllable", async () => {
    const [content] = await fetchWith({
      Type: "Static",
      Unsynced: true,
      Content: [{ Lead: { Syllables: [{ Text: "run" }, { Text: "ning", IsPartOfWord: true }] } }],
    });

    expect((content as any).Lines[0].Text).toBe("running");
  });

  it("keeps a Text already present on the line", async () => {
    const [content] = await fetchWith({
      Type: "Static",
      Unsynced: true,
      Content: [{ Text: "already here" }],
    });

    expect((content as any).Lines[0].Text).toBe("already here");
  });

  it("leaves synced payloads untouched", async () => {
    const [content] = await fetchWith({
      Type: "Syllable",
      Content: [{ Lead: { StartTime: 1, EndTime: 2, Syllables: [{ Text: "x", StartTime: 1, EndTime: 2 }] } }],
    });

    expect((content as any).Lines).toBeUndefined();
    expect((content as any).Type).toBe("Syllable");
  });

  it("produces an empty Lines array rather than undefined when Content is missing", async () => {
    const [content] = await fetchWith({ Type: "Static", Unsynced: true });

    expect((content as any).Lines).toEqual([]);
  });
});
