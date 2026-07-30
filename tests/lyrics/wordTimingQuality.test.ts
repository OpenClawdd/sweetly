/**
 * Word-timing quality gate.
 *
 * lyricsCoverTrack asks whether the timings span the track. Every one of the
 * 35 files in ~/.sweetly-custom passed that check at 100% coverage while 32 of
 * them were unusable, because the damage is *inside* the span, not at its ends.
 *
 * Two signatures, both traceable to scripts/align_lyrics.py. Words the aligner
 * could not place come out of sanitize() at exactly the 0.05s floor, so they
 * flash past unreadably; and line timings copied onto word spans leave every
 * "word" holding a whole line, so nothing highlights until the line is over.
 * spread_degenerate_runs only repairs pile-ups of 6+ words sharing a
 * timestamp, so everything else reaches disk looking structurally perfect.
 */
import { describe, expect, test } from "vitest";
import { wordTimingsUsable } from "../../src/main/lyrics/utils.js";

/** A line whose syllables have the given [start, end] pairs, in seconds. */
function line(pairs: [number, number][]) {
  return {
    Lead: {
      StartTime: pairs[0][0],
      EndTime: pairs[pairs.length - 1][1],
      Syllables: pairs.map(([StartTime, EndTime], i) => ({ Text: `w${i}`, StartTime, EndTime })),
    },
  };
}

/** n consecutive words of `dur` seconds each, starting at `from`. */
function run(n: number, dur: number, from = 0): [number, number][] {
  return Array.from({ length: n }, (_, i) => [from + i * dur, from + (i + 1) * dur]);
}

describe("wordTimingsUsable", () => {
  test("accepts a normal alignment", () => {
    const data = { Type: "Syllable", Content: [line(run(10, 0.3)), line(run(10, 0.25, 3))] };
    expect(wordTimingsUsable(data)).toBe(true);
  });

  test("rejects a file where every word sits at the 0.05s floor", () => {
    // artnotrap_slayr.ttml: 71 of 71 words at exactly 50ms.
    const data = { Type: "Syllable", Content: [line(run(40, 0.05)), line(run(31, 0.05, 2))] };
    expect(wordTimingsUsable(data)).toBe(false);
  });

  test("rejects line timings copied onto word spans", () => {
    // cirno_s_perfect_math_class_iosys.ttml: 82 words, median 3.02s each.
    const data = { Type: "Syllable", Content: [line(run(20, 3.0)), line(run(20, 2.8, 60))] };
    expect(wordTimingsUsable(data)).toBe(false);
  });

  test("rejects a mostly-degraded alignment", () => {
    // wipe_yo_nose: ~48% of words either crammed or stuck.
    const good = run(20, 0.3);
    const crammed = run(15, 0.05, 6);
    const stuck: [number, number][] = [[8, 10.5], [10.5, 13]];
    const data = { Type: "Syllable", Content: [line(good), line(crammed), line(stuck)] };
    expect(wordTimingsUsable(data)).toBe(false);
  });

  test("accepts a handful of short words in an otherwise sound file", () => {
    const data = { Type: "Syllable", Content: [line(run(30, 0.3)), line([...run(2, 0.05, 9), ...run(8, 0.28, 10)])] };
    expect(wordTimingsUsable(data)).toBe(true);
  });

  test("rejects line-level lyrics pinned at the floor", () => {
    // artnotrap_slayr.ttml parses to one span per line, every one 50ms long.
    // Not word-level damage — the whole line flashes past — so the crammed
    // check has to apply regardless of granularity.
    const data = { Type: "Syllable", Content: run(20, 0.05).map((p) => line([p])) };
    expect(wordTimingsUsable(data)).toBe(false);
  });

  test("does not judge line-level lyrics, whose spans are legitimately long", () => {
    // One syllable per line covering the whole line is what line-synced looks
    // like; judging it by word rules would reject every LRCLIB result.
    const data = {
      Type: "Syllable",
      Content: [line([[0, 4]]), line([[4, 8.5]]), line([[8.5, 13]]), line([[13, 17]])],
    };
    expect(wordTimingsUsable(data)).toBe(true);
  });

  test("accepts unsynced and static payloads untouched", () => {
    expect(wordTimingsUsable({ Type: "Static", Content: [] })).toBe(true);
    expect(wordTimingsUsable({ Unsynced: true, Content: [line(run(20, 0.05))] })).toBe(true);
  });

  test("accepts a file too small to judge", () => {
    expect(wordTimingsUsable({ Type: "Syllable", Content: [line(run(3, 0.05))] })).toBe(true);
  });
});
