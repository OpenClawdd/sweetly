import { describe, it, expect } from "vitest";
// @ts-expect-error - main/ is plain JS with no type declarations
import { lyricsCoverTrack } from "../../src/main/lyrics/utils.js";

/** Build a synced parse result whose last line ends at `lastEnd` seconds. */
function synced(lastEnd: number) {
  return {
    Type: "Syllable",
    Unsynced: false,
    Content: [
      { Lead: { StartTime: 0, EndTime: 1, Syllables: [{ Text: "a", StartTime: 0, EndTime: 1 }] } },
      {
        Lead: {
          StartTime: lastEnd - 0.5,
          EndTime: lastEnd,
          Syllables: [{ Text: "b", StartTime: lastEnd - 0.5, EndTime: lastEnd }],
        },
      },
    ],
  };
}

describe("lyricsCoverTrack", () => {
  it("rejects the collapsed aligner output that broke Hard Knock", () => {
    // Real file: ~/.sweetly-custom/hard_knock_slayr.ttml — 69 lines, every one
    // stamped inside the first 3.73s of a 162s track.
    expect(lyricsCoverTrack(synced(3.73), 161.99)).toBe(false);
  });

  it("rejects every other collapse from the same aligner run", () => {
    // body dur / plausible track length, from the 2026-07-27 batch.
    expect(lyricsCoverTrack(synced(5.383), 180)).toBe(false); // flashout_freestyle
    expect(lyricsCoverTrack(synced(35.733), 300)).toBe(false); // last_call (302 lines)
    expect(lyricsCoverTrack(synced(73.384), 210)).toBe(false); // charlie_s_inferno
  });

  it("accepts alignments that run to the end of the track", () => {
    expect(lyricsCoverTrack(synced(152.971), 160)).toBe(true); // wol_waera
    expect(lyricsCoverTrack(synced(125.981), 132)).toBe(true); // paint_a_picture
  });

  it("accepts a song with a long instrumental outro", () => {
    // Lyrics stop at 3:30 of a 5:00 track — 70% coverage is normal, not a bug.
    expect(lyricsCoverTrack(synced(210), 300)).toBe(true);
  });

  it("accepts a sparse file when the track duration is unknown", () => {
    // Two lines over 3.7s is slow enough to be real; with no duration there is
    // no coverage judgement to make, so it must not be rejected.
    expect(lyricsCoverTrack(synced(3.73), undefined)).toBe(true);
    expect(lyricsCoverTrack(synced(3.73), 0)).toBe(true);
  });

  it("rejects an impossible delivery rate even with no duration", () => {
    // The real hole: appleMusic.js yields `duration: ... || 0` when Music.app
    // is stopped, so the coverage check silently no-ops. 537 words inside 2.4s
    // is physically impossible whatever the track length turns out to be.
    const crammed = {
      Type: "Syllable",
      Unsynced: false,
      Content: Array.from({ length: 69 }, (_, i) => {
        const t = 1.327 + i * 0.035;
        return {
          Lead: {
            StartTime: t,
            EndTime: t + 0.03,
            Syllables: Array.from({ length: 8 }, (_, w) => ({
              Text: `w${w}`,
              StartTime: t + w * 0.004,
              EndTime: t + w * 0.004 + 0.05,
            })),
          },
        };
      }),
    };
    expect(lyricsCoverTrack(crammed, undefined)).toBe(false);
    expect(lyricsCoverTrack(crammed, 0)).toBe(false);
    expect(lyricsCoverTrack(crammed, 161.99)).toBe(false);
  });

  it("accepts a genuinely fast rap at a human rate", () => {
    // ~7 words/sec sustained — fast, but people do this.
    const fast = {
      Type: "Syllable",
      Unsynced: false,
      Content: Array.from({ length: 40 }, (_, i) => ({
        Lead: {
          StartTime: i * 4,
          EndTime: i * 4 + 3.9,
          Syllables: Array.from({ length: 28 }, (_, w) => ({
            Text: `w${w}`,
            StartTime: i * 4 + w * 0.14,
            EndTime: i * 4 + w * 0.14 + 0.13,
          })),
        },
      })),
    };
    expect(lyricsCoverTrack(fast, 165)).toBe(true);
  });

  it("accepts unsynced lyrics, which carry no timings to judge", () => {
    const unsynced = { ...synced(0), Type: "Static", Unsynced: true };
    expect(lyricsCoverTrack(unsynced, 161.99)).toBe(true);
  });

  it("rejects synced lyrics whose timings are all zero", () => {
    expect(lyricsCoverTrack(synced(0), 161.99)).toBe(false);
  });

  it("reads the last end time from syllables when the line lacks one", () => {
    const data = {
      Type: "Syllable",
      Unsynced: false,
      Content: [
        {
          Lead: {
            StartTime: 0,
            EndTime: 0,
            Syllables: [{ Text: "a", StartTime: 140, EndTime: 150 }],
          },
        },
      ],
    };
    expect(lyricsCoverTrack(data, 160)).toBe(true);
  });

  it("survives malformed input without throwing", () => {
    expect(lyricsCoverTrack(null, 160)).toBe(true);
    expect(lyricsCoverTrack({ Content: [] }, 160)).toBe(true);
    expect(lyricsCoverTrack({ Content: [{}] }, 160)).toBe(false);
  });
});
