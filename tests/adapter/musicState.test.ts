import { describe, expect, test, beforeEach } from "vitest";
import {
  EMPTY_STATE,
  getMusicState,
  setMusicStateForTest,
  onMusicStateChange,
  type MusicState,
} from "../../src/renderer/adapter/musicState.ts";

const PLAYING: MusicState = {
  status: "playing",
  track: {
    name: "Sloppy Joe",
    nameCleaned: "Sloppy Joe",
    artist: "slayr",
    artistCleaned: "slayr",
    album: "BLOODLUXX",
    position: 47.5,
    duration: 147,
  },
  shuffle: false,
  repeat: "off",
  favorited: false,
};

beforeEach(() => setMusicStateForTest(EMPTY_STATE));

describe("musicState", () => {
  test("defaults to a closed state with no track", () => {
    expect(getMusicState().status).toBe("closed");
    expect(getMusicState().track).toBeNull();
  });

  test("stores the most recent payload", () => {
    setMusicStateForTest(PLAYING);
    expect(getMusicState().track?.name).toBe("Sloppy Joe");
    expect(getMusicState().track?.position).toBe(47.5);
  });

  test("notifies subscribers on change", () => {
    const seen: string[] = [];
    const off = onMusicStateChange((s) => seen.push(s.status));
    setMusicStateForTest(PLAYING);
    off();
    expect(seen).toEqual(["playing"]);
  });

  test("unsubscribe stops notifications", () => {
    const seen: string[] = [];
    const off = onMusicStateChange((s) => seen.push(s.status));
    off();
    setMusicStateForTest(PLAYING);
    expect(seen).toEqual([]);
  });

  test("a throwing subscriber does not block the others", () => {
    const seen: string[] = [];
    const offBad = onMusicStateChange(() => {
      throw new Error("subscriber blew up");
    });
    const offGood = onMusicStateChange((s) => seen.push(s.status));
    expect(() => setMusicStateForTest(PLAYING)).not.toThrow();
    offBad();
    offGood();
    expect(seen).toEqual(["playing"]);
  });
});
