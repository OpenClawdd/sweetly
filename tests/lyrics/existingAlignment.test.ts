import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  convertAlignedJsonToTTML,
  existingAlignmentIsUsable,
} from "../../src/main/lyrics/autoAligner.js";

/**
 * A collapsed alignment is a tombstone: `triggerAutoAlignment` used to skip any
 * track whose .ttml already existed, so a file that stamped the whole song into
 * four seconds permanently blocked its own replacement. Playing the track again
 * could never fix it. The aligner has to judge the file, not just find it.
 */

const DURATION = 200;
let dir: string;

/**
 * Build a TTML file whose lines run from `start` to `end`, evenly spaced.
 *
 * `wordsPerLine` defaults to 5 to match the real library — the collapsed
 * Kid Rock file carried 402 words across 74 lines. Two words per line would
 * make even an 18-second "collapse" only ~9 words/sec, which is merely fast
 * rather than physically impossible, so the rate check would rightly pass it.
 */
function writeTTML(name: string, lineCount: number, start: number, end: number, wordsPerLine = 5) {
  const step = (end - start) / lineCount;
  const segments = Array.from({ length: lineCount }, (_, i) => {
    const s = start + i * step;
    const e = s + step * 0.9;
    const wordStep = (e - s) / wordsPerLine;
    return {
      start: s,
      end: e,
      words: Array.from({ length: wordsPerLine }, (_, w) => ({
        word: `w${w}`,
        start: s + w * wordStep,
        end: s + (w + 1) * wordStep,
      })),
    };
  });
  const file = path.join(dir, name);
  fs.writeFileSync(file, convertAlignedJsonToTTML({ segments }, "Test Artist"), "utf8");
  return file;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweetly-align-"));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("existingAlignmentIsUsable", () => {
  it("rejects a collapsed file so it can be regenerated", () => {
    // 74 lines crammed into 18s — the real shape of the broken library.
    const file = writeTTML("collapsed.ttml", 74, 1, 18);
    expect(existingAlignmentIsUsable(file, DURATION)).toBe(false);
  });

  it("keeps a healthy file that spans the track", () => {
    const file = writeTTML("healthy.ttml", 74, 5, 198);
    expect(existingAlignmentIsUsable(file, DURATION)).toBe(true);
  });

  it("rejects a file that does not exist", () => {
    expect(existingAlignmentIsUsable(path.join(dir, "nope.ttml"), DURATION)).toBe(false);
  });

  it("rejects an unparseable file rather than trusting it", () => {
    const file = path.join(dir, "garbage.ttml");
    fs.writeFileSync(file, "<tt><body><div>", "utf8");
    expect(existingAlignmentIsUsable(file, DURATION)).toBe(false);
  });

  it("keeps a healthy file even when the duration is unknown", () => {
    // Music.app reports duration 0 when stopped; a sane delivery rate still
    // proves the file is not collapsed.
    const file = writeTTML("healthy-nodur.ttml", 74, 5, 198);
    expect(existingAlignmentIsUsable(file, 0)).toBe(true);
  });

  it("rejects a collapsed file even when the duration is unknown", () => {
    const file = writeTTML("collapsed-nodur.ttml", 74, 1, 18);
    expect(existingAlignmentIsUsable(file, 0)).toBe(false);
  });
});
