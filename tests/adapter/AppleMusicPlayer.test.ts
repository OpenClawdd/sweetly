import { describe, expect, test, beforeEach } from "vitest";
import {
  EMPTY_STATE,
  setMusicStateForTest,
  type MusicState,
} from "../../src/renderer/adapter/musicState.ts";
import {
  SpotifyPlayer,
  setArtworkUrl,
  getArtworkUrl,
} from "../../src/renderer/adapter/AppleMusicPlayer.ts";

const PLAYING: MusicState = {
  status: "playing",
  track: {
    name: "If We Being Rëal",
    nameCleaned: "If We Being Rëal",
    artist: "Yeat",
    artistCleaned: "Yeat",
    album: "2093",
    position: 111,
    duration: 172,
  },
  shuffle: true,
  repeat: "all",
  favorited: false,
};

beforeEach(() => {
  setMusicStateForTest(EMPTY_STATE);
  setArtworkUrl(null);
});

describe("AppleMusicPlayer", () => {
  test("converts duration from seconds to milliseconds", () => {
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.GetDuration()).toBe(172_000);
  });

  test("returns 0 duration when nothing is loaded", () => {
    expect(SpotifyPlayer.GetDuration()).toBe(0);
  });

  test("converts raw position from seconds to milliseconds", () => {
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.GetRawPosition()).toBe(111_000);
  });

  test("exposes track metadata", () => {
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.GetName()).toBe("If We Being Rëal");
    expect(SpotifyPlayer.GetAlbumName()).toBe("2093");
    expect(SpotifyPlayer.GetArtists()?.[0]?.name).toBe("Yeat");
  });

  test("derives a stable id from cleaned name and artist", () => {
    setMusicStateForTest(PLAYING);
    const first = SpotifyPlayer.GetId();
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.GetId()).toBe(first);
    expect(first).toContain("yeat");
  });

  test("id changes when the track changes", () => {
    setMusicStateForTest(PLAYING);
    const first = SpotifyPlayer.GetId();
    setMusicStateForTest({
      ...PLAYING,
      track: { ...PLAYING.track!, nameCleaned: "Other Song" },
    });
    expect(SpotifyPlayer.GetId()).not.toBe(first);
  });

  test("id is undefined with no track", () => {
    expect(SpotifyPlayer.GetId()).toBeUndefined();
  });

  test("reflects shuffle and repeat state", () => {
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.ShuffleType).toBe("smart");
    expect(SpotifyPlayer.LoopType).toBe("all");
  });

  test("IsPlaying tracks status", () => {
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.IsPlaying).toBe(true);
    setMusicStateForTest({ ...PLAYING, status: "paused" });
    expect(SpotifyPlayer.IsPlaying).toBe(false);
  });

  test("is never a DJ session and always reports a track content type", () => {
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.IsDJ()).toBe(false);
    expect(SpotifyPlayer.GetContentType()).toBe("track");
  });

  test("Playbar stubs construct without touching the DOM or scheduling timers", () => {
    const button = new SpotifyPlayer.Playbar.Button("Label", "<svg/>");
    expect(button.element.tagName).toBe("BUTTON");
    expect(button.label).toBe("Label");
    expect(() => button.register()).not.toThrow();
    expect(() => button.deregister()).not.toThrow();
  });

  test("Playbar Widget shares the Button shape", () => {
    const widget = new SpotifyPlayer.Playbar.Widget("Heart", "<svg/>");
    expect(widget.element.tagName).toBe("BUTTON");
    expect(() => widget.deregister()).not.toThrow();
  });

  test("falls back to a placeholder cover when no artwork is set", () => {
    expect(SpotifyPlayer.GetCover("large")).toContain("SongPlaceholder");
  });

  test("returns the artwork url once the fetch path supplies one", () => {
    setArtworkUrl("https://example.test/art.jpg");
    expect(getArtworkUrl()).toBe("https://example.test/art.jpg");
    expect(SpotifyPlayer.GetCover("large")).toBe("https://example.test/art.jpg");
  });

  test("GetCoverFrom picks the matching label", () => {
    const source = [
      { url: "https://example.test/small.jpg", label: "small" },
      { url: "https://example.test/large.jpg", label: "large" },
    ];
    expect(SpotifyPlayer.GetCoverFrom("large", source)).toBe("https://example.test/large.jpg");
  });

  test("GetCoverFrom falls back to the placeholder for an empty source", () => {
    expect(SpotifyPlayer.GetCoverFrom("large", [])).toContain("SongPlaceholder");
  });

  test("GetUri is namespaced to apple, not spotify", () => {
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.GetUri()).toMatch(/^apple:track:/);
  });
});
