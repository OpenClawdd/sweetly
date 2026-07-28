# Punchy Lyrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lyrics view hit hard — by fixing the content bugs that corrupt aligned lyrics, anchoring alignment to known line timings so it cannot collapse, then adding the per-line motion and contrast the renderer currently lacks.

**Architecture:** Part A fixes the data going in. The centrepiece is **anchored alignment**: LRCLIB already knows where every line starts and ends, so each line is aligned inside its own 2–4 second slice of audio instead of being rediscovered by walking blind 26-second windows. A line's words cannot escape that line's window, which makes the collapse failure structurally impossible and removes most of the windowing machinery. Part B adds a host-side stylesheet plus a motion layer driving per-line spring physics — a capability upstream ships commented out.

**Tech Stack:** Node ESM (`src/main/`), TypeScript (`src/renderer/`), Python 3 (`scripts/`), vitest, plain CSS.

## Global Constraints

- **Never edit anything under `src/` except `main/`, `preload/` and `renderer/`.** `src/` is a vendored AGPL fork of Spicy Lyrics 6.2.3. `src/components/`, `src/css/`, `src/utils/` are off limits.
- Renderer makes no direct network requests — everything routes through the main process over IPC.
- `main/` and `preload/` are `.js`; `renderer/` is `.ts`. All ESM.
- Use `npm`, not `bun`. Tests are vitest, not `bun test`.
- Apple Music reports **seconds**; parsed TTML timings are in **seconds**.
- Run JS tests with `npx vitest run <path>`; Python tests with `python3 <path>`.

## Measured Facts Driving This Plan

Established by probing the real library — do not re-derive:

- Apple Music is **line-level on all 10** broken tracks. Zero word-level. No external source (AMLL TTML DB, FMHY's listings, TIDAL) has word timings for this catalog. Local alignment is the only path.
- Apple text is **censored on 7 of 10**; LRCLIB is **uncensored on all 9** it covers.
- LRCLIB covers every broken track **except** "Marisa Stole the Precious Thing" (IOSYS), which has neither source and must fall back to the ASR path.

## File Structure

**Part A**
- `src/main/lyrics/utils.js` — add `isCensored()`, `pickAlignmentText()`, `toLineAnchors()` beside `lyricsCoverTrack()`. Pure functions.
- `src/main/lyrics/fetcher.js` — hoist the LRCLIB fetch above the aligner trigger; pass text and anchors.
- `src/main/lyrics/autoAligner.js` — narrow the ad-lib rule; write the anchors file; pass `--anchors`.
- `scripts/align_lyrics.py` — preserve masked tokens; add the anchored alignment path.
- Tests: `tests/lyrics/alignmentText.test.ts`, `tests/lyrics/lineAnchors.test.ts`, `tests/lyrics/adlibs.test.ts`, `tests/test_align_text.py`, `tests/test_align_anchored.py`.

**Part B**
- `src/renderer/styles/punch.css` — contrast, type scale, scrim, bloom.
- `src/renderer/lyrics/punchLayer.ts` — per-line spring and depth blur.
- `src/renderer/main.ts` — import the stylesheet, start the layer.
- `src/main/lyrics/ttmlXml.js` — split line-level `<p>` into per-word syllables.
- Test: `tests/lyrics/lineSplitting.test.ts`.

---

### Task 1: Censorship detection and alignment-target selection

**Files:**
- Modify: `src/main/lyrics/utils.js` (append after `lyricsCoverTrack`)
- Test: `tests/lyrics/alignmentText.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `isCensored(text: string): boolean`, `pickAlignmentText(candidates: Array<{source: string, text: string}>): {source: string, text: string} | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/alignmentText.test.ts`:

```ts
import { describe, it, expect } from "vitest";
// @ts-expect-error - main/ is plain JS with no type declarations
import { isCensored, pickAlignmentText } from "../../src/main/lyrics/utils.js";

describe("isCensored", () => {
  it("detects runs of two or more asterisks", () => {
    expect(isCensored("these **** here")).toBe(true);
    expect(isCensored("a ** b")).toBe(true);
  });

  it("does not flag ordinary text or a lone asterisk", () => {
    expect(isCensored("nothing masked here")).toBe(false);
    expect(isCensored("5 * 3 = 15")).toBe(false);
    expect(isCensored("")).toBe(false);
    expect(isCensored(null)).toBe(false);
  });
});

describe("pickAlignmentText", () => {
  it("prefers an uncensored candidate over a censored one", () => {
    const got = pickAlignmentText([
      { source: "apple", text: "these **** here" },
      { source: "lrclib", text: "these words here" },
    ]);
    expect(got?.source).toBe("lrclib");
  });

  it("keeps source order when neither is censored", () => {
    const got = pickAlignmentText([
      { source: "apple", text: "clean one" },
      { source: "lrclib", text: "clean two" },
    ]);
    expect(got?.source).toBe("apple");
  });

  it("falls back to the least-masked candidate when all are censored", () => {
    const got = pickAlignmentText([
      { source: "apple", text: "**** and **** and ****" },
      { source: "lrclib", text: "**** only once" },
    ]);
    expect(got?.source).toBe("lrclib");
  });

  it("ignores empty and whitespace-only candidates", () => {
    const got = pickAlignmentText([
      { source: "apple", text: "" },
      { source: "genius", text: "   \n  " },
      { source: "lrclib", text: "real text" },
    ]);
    expect(got?.source).toBe("lrclib");
  });

  it("returns null when there is nothing usable", () => {
    expect(pickAlignmentText([])).toBe(null);
    expect(pickAlignmentText([{ source: "apple", text: "" }])).toBe(null);
    expect(pickAlignmentText(null)).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/alignmentText.test.ts`
Expected: FAIL — `isCensored is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/main/lyrics/utils.js`:

```js
/** Two or more asterisks in a row is a masked word, not punctuation. */
const CENSOR_RE = /\*{2,}/;

/** Does this text contain masked (censored) words? */
export function isCensored(text) {
  return CENSOR_RE.test(String(text || ""));
}

/**
 * Choose which source's plain text to hand the forced aligner.
 *
 * Apple serves fully-masked words for some tracks even when the explicit
 * release is matched — measured at 7 of 10 across this library. `norm()` in
 * align_lyrics.py reduces a mask to the empty string, so the word is dropped
 * rather than voiced and the line comes back a word short.
 *
 * Candidates are considered in order, so callers list their preferred source
 * first. When every candidate is masked, the least-masked one wins.
 */
export function pickAlignmentText(candidates) {
  const usable = (candidates ?? []).filter((c) => String(c?.text || "").trim().length > 0);
  if (!usable.length) return null;

  const clean = usable.find((c) => !isCensored(c.text));
  if (clean) return clean;

  let best = usable[0];
  let bestMasks = (best.text.match(/\*{2,}/g) || []).length;
  for (const cand of usable.slice(1)) {
    const masks = (cand.text.match(/\*{2,}/g) || []).length;
    if (masks < bestMasks) {
      best = cand;
      bestMasks = masks;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/alignmentText.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/lyrics/utils.js tests/lyrics/alignmentText.test.ts
git commit -m "feat(lyrics): detect censored text and pick a clean alignment target"
```

---

### Task 2: Extract line anchors from a synced source

LRCLIB's parsed output carries `Lead.StartTime` / `Lead.EndTime` per line. Today the aligner throws those away and rediscovers them. This exposes them as anchors.

**Files:**
- Modify: `src/main/lyrics/utils.js` (append after `pickAlignmentText`)
- Test: `tests/lyrics/lineAnchors.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `toLineAnchors(data): Array<{text: string, start: number, end: number}>` — Task 3 passes this to the aligner, Task 6 consumes it in Python.

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/lineAnchors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
// @ts-expect-error - main/ is plain JS with no type declarations
import { toLineAnchors } from "../../src/main/lyrics/utils.js";

function line(words: string[], start: number, end: number) {
  return {
    Lead: {
      StartTime: start,
      EndTime: end,
      Syllables: words.map((w, i) => ({
        Text: w,
        StartTime: start + i * 0.1,
        EndTime: start + i * 0.1 + 0.09,
      })),
    },
  };
}

describe("toLineAnchors", () => {
  it("returns one anchor per line, with reconstructed text", () => {
    const data = { Type: "Syllable", Content: [line(["one", "two"], 1, 3), line(["three"], 3, 5)] };
    expect(toLineAnchors(data)).toEqual([
      { text: "one two", start: 1, end: 3 },
      { text: "three", start: 3, end: 5 },
    ]);
  });

  it("drops lines with no usable window", () => {
    const data = {
      Type: "Syllable",
      Content: [line(["ok"], 1, 3), line(["bad"], 5, 5), line(["worse"], 9, 8)],
    };
    expect(toLineAnchors(data).map((a: any) => a.text)).toEqual(["ok"]);
  });

  it("drops lines with no text", () => {
    const data = { Type: "Syllable", Content: [line([], 1, 3), line(["kept"], 3, 5)] };
    expect(toLineAnchors(data).map((a: any) => a.text)).toEqual(["kept"]);
  });

  it("returns nothing for unsynced or empty input", () => {
    expect(toLineAnchors({ Content: [line(["a"], 1, 2)], Unsynced: true })).toEqual([]);
    expect(toLineAnchors({ Content: [] })).toEqual([]);
    expect(toLineAnchors(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/lineAnchors.test.ts`
Expected: FAIL — `toLineAnchors is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/main/lyrics/utils.js`:

```js
/**
 * Line-level time windows from a synced source, for anchored alignment.
 *
 * LRCLIB already knows where each line begins and ends. Handing those windows
 * to the aligner lets it align each line inside its own slice of audio instead
 * of rediscovering the whole track by walking blind windows — which is what
 * allowed a token cursor to outrun the audio and stamp a whole song into a few
 * seconds.
 */
export function toLineAnchors(data) {
  if (!data?.Content?.length || data.Unsynced) return [];

  const anchors = [];
  for (const line of data.Content) {
    const lead = line?.Lead;
    if (!lead?.Syllables?.length) continue;

    const text = lead.Syllables.map((s) => s?.Text ?? "").join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const start = Number(lead.StartTime);
    const end = Number(lead.EndTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    anchors.push({ text, start, end });
  }
  return anchors;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/lineAnchors.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/lyrics/utils.js tests/lyrics/lineAnchors.test.ts
git commit -m "feat(lyrics): expose line-level time windows as alignment anchors"
```

---

### Task 3: Feed the aligner clean text and anchors

`fetcher.js` triggers the aligner at line 88 but does not fetch LRCLIB until line 109 — so neither the clean text nor the anchors exist yet at the point they are needed. Hoist the fetch.

**Files:**
- Modify: `src/main/lyrics/fetcher.js`

**Interfaces:**
- Consumes: `pickAlignmentText`, `toLineAnchors` from Tasks 1–2.
- Produces: `triggerAutoAlignment` now receives an `anchors` option (implemented in Task 7).

- [ ] **Step 1: Add the import**

`src/main/lyrics/fetcher.js` has no import from `./utils.js`. Add one after the existing source imports:

```js
import { pickAlignmentText, toLineAnchors } from "./utils.js";
```

- [ ] **Step 2: Hoist the LRCLIB fetch above the aligner trigger**

Find this block (currently around lines 85–96):

```js
  // Nothing word-level exists anywhere. Capture the audio as it plays and
  // derive timings — using Apple's untimed text as the alignment target when
  // we have it, so the aligner never has to guess the words.
  const alignResult = await safe("auto-aligner", () =>
    triggerAutoAlignment({
      name,
      artist,
      duration: playback.duration,
      position: playback.position ?? 0,
      lyricsText: lyricsToPlainText(appleLyrics),
    }),
  );
```

Replace it with:

```js
  // LRCLIB is fetched here rather than at its own step below, because the
  // aligner needs two things from it: uncensored text (Apple masks words on
  // most of this library) and line-level time windows to anchor against.
  const lrcLib = await safe("lrclib", () => fetchLRCLib(name, artist));

  // Nothing word-level exists anywhere. Capture the audio as it plays and
  // derive timings from the cleanest untimed text we have.
  const alignTarget = pickAlignmentText([
    { source: "lrclib", text: lyricsToPlainText(lrcLib) },
    { source: "apple", text: lyricsToPlainText(appleLyrics) },
  ]);
  // Anchors only come from the source whose text we actually chose — mixing
  // one source's windows with another's wording would misalign every line.
  const anchors = alignTarget?.source === "lrclib" ? toLineAnchors(lrcLib) : [];
  if (alignTarget) {
    console.log(
      "[Sweetly-Main] Alignment target:", alignTarget.source,
      anchors.length ? `(${anchors.length} anchored lines)` : "(unanchored)",
    );
  }

  const alignResult = await safe("auto-aligner", () =>
    triggerAutoAlignment({
      name,
      artist,
      duration: playback.duration,
      position: playback.position ?? 0,
      lyricsText: alignTarget?.text ?? "",
      anchors,
    }),
  );
```

- [ ] **Step 3: Remove the now-duplicated LRCLIB fetch**

Further down, find:

```js
  // 6. LRCLIB (line-level LRC), then Genius (plain text)
  const lrcLib = await safe("lrclib", () => fetchLRCLib(name, artist));
  if (lrcLib) {
```

Replace with:

```js
  // 6. LRCLIB (line-level LRC), then Genius (plain text).
  // Already fetched above, because the aligner needed its text and anchors.
  if (lrcLib) {
```

- [ ] **Step 4: Verify the suite still passes**

Run: `npx vitest run`
Expected: PASS — 90 tests. This task changes ordering, not results.

- [ ] **Step 5: Verify against the real track**

```bash
node --input-type=module -e "
const { fetchLRCLib } = await import('./src/main/lyrics/sources/lrclib.js');
const { findAppleMusicLyrics } = await import('./src/main/appleMusicApi.js');
const { pickAlignmentText, isCensored, toLineAnchors } = await import('./src/main/lyrics/utils.js');
const flat = (d) => !d?.Content ? '' : d.Content.map(l=>(l.Lead?.Syllables||[]).map(s=>s.Text).join(' ')).join('\n');
const apple = (await findAppleMusicLyrics('Hard Knock','slayr','Half Blood (BloodLuxe)'))?.lyrics;
const lrc = await fetchLRCLib('Hard Knock','slayr');
console.log('apple censored:', isCensored(flat(apple)));
console.log('lrclib censored:', isCensored(flat(lrc)));
const pick = pickAlignmentText([{source:'lrclib',text:flat(lrc)},{source:'apple',text:flat(apple)}]);
console.log('chosen:', pick?.source, '| anchors:', toLineAnchors(lrc).length);
process.exit(0);
" 2>&1 | grep -vE "AppleMusicAPI|Sweetly-Main"
```

Expected: `apple censored: true`, `lrclib censored: false`, `chosen: lrclib`, anchor count > 30.

- [ ] **Step 6: Commit**

```bash
git add src/main/lyrics/fetcher.js
git commit -m "fix(lyrics): align against uncensored text with line anchors"
```

---

### Task 4: Stop the ad-lib rule eating ordinary words

`autoAligner.js:87` lists `pop`, `yeah`, `oh`, `ha`, `gang` as interjections and `:119` tests every token, so any standalone occurrence is relocated into a background span and the lead line loses the word.

**Files:**
- Modify: `src/main/lyrics/autoAligner.js:112-133`
- Test: `tests/lyrics/adlibs.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: no signature change to `convertAlignedJsonToTTML(rawJson, artistName, offsetSeconds)`.

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/adlibs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
// @ts-expect-error - main/ is plain JS with no type declarations
import { convertAlignedJsonToTTML } from "../../src/main/lyrics/autoAligner.js";

/** One aligned segment from a list of words, half a second apart. */
function seg(words: string[]) {
  return {
    segments: [
      {
        start: 0,
        end: words.length * 0.5,
        words: words.map((w, i) => ({ word: w, start: i * 0.5, end: i * 0.5 + 0.4 })),
      },
    ],
  };
}

/** Text of the lead line — everything not inside an x-bg span. */
function lead(ttml: string) {
  const p = ttml.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
  const withoutBg = p.replace(/<span ttm:role="x-bg">[\s\S]*?<\/span>/g, "");
  return (withoutBg.match(/>([^<>]+)</g) || []).map((s) => s.slice(1, -1).trim()).join(" ").trim();
}

function background(ttml: string) {
  const bg = ttml.match(/<span ttm:role="x-bg">([\s\S]*?)<\/span>/)?.[1] ?? "";
  return (bg.match(/>([^<>]+)</g) || []).map((s) => s.slice(1, -1).trim()).join(" ").trim();
}

describe("convertAlignedJsonToTTML ad-lib classification", () => {
  it("keeps an interjection word that is part of a real line in the lead", () => {
    const ttml = convertAlignedJsonToTTML(seg(["going", "to", "pop", "the", "top"]));
    expect(lead(ttml)).toBe("going to pop the top");
    expect(background(ttml)).toBe("");
  });

  it("treats a parenthesised word as background wherever it appears", () => {
    const ttml = convertAlignedJsonToTTML(seg(["run", "it", "(yeah)", "back"]));
    expect(lead(ttml)).toBe("run it back");
    expect(background(ttml)).toBe("yeah");
  });

  it("treats a whole line that is only an interjection as background", () => {
    const ttml = convertAlignedJsonToTTML(seg(["Wow"]));
    expect(background(ttml)).toBe("Wow");
  });

  it("keeps a multi-word line of ordinary words entirely in the lead", () => {
    const ttml = convertAlignedJsonToTTML(seg(["gang", "gang", "on", "the", "block"]));
    expect(lead(ttml)).toBe("gang gang on the block");
    expect(background(ttml)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/adlibs.test.ts`
Expected: FAIL — the first test finds `pop` moved to background.

- [ ] **Step 3: Write the implementation**

In `src/main/lyrics/autoAligner.js`, replace the word loop:

```js
    for (const w of words) {
      const raw = String(w.word || "").trim();
      if (!raw) continue;
      const clean = raw.replace(/[()]/g, "").trim();
      if (!clean) continue;

      const span = `<span begin="${shift(w.start, seg.start)}" end="${shift(w.end, seg.end)}">${escapeXml(clean)} </span>`;
      if (raw.startsWith("(") || INTERJECTIONS.test(raw)) bgSpans += span;
      else leadSpans += span;
    }
```

with:

```js
    // An interjection only counts as an ad-lib when it stands alone as its own
    // line. Testing every token meant ordinary lyrics containing "pop", "yeah"
    // or "gang" had that word pulled out of the lead and stacked underneath.
    const isLoneInterjection = words.length === 1;

    for (const w of words) {
      const raw = String(w.word || "").trim();
      if (!raw) continue;
      const clean = raw.replace(/[()]/g, "").trim();
      if (!clean) continue;

      const span = `<span begin="${shift(w.start, seg.start)}" end="${shift(w.end, seg.end)}">${escapeXml(clean)} </span>`;
      if (raw.startsWith("(") || (isLoneInterjection && INTERJECTIONS.test(raw))) bgSpans += span;
      else leadSpans += span;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/adlibs.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/lyrics/autoAligner.js tests/lyrics/adlibs.test.ts
git commit -m "fix(lyrics): only treat a lone interjection as an ad-lib"
```

---

### Task 5: Preserve masked tokens so lines keep their shape

When no clean source exists (3 of 10 tracks), the masked word should still occupy its slot. Today `lyric_lines` drops it and `regroup_spans_into_lines` skips it.

**Files:**
- Modify: `scripts/align_lyrics.py:31-48` and `:51-83`
- Test: `tests/test_align_text.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `MASK_RE`; unchanged signatures for `lyric_lines(text)` and `regroup_spans_into_lines(spans, lines)`. Task 6 uses both.

- [ ] **Step 1: Write the failing test**

Create `tests/test_align_text.py`:

```python
#!/usr/bin/env python3
"""Masked-token handling in scripts/align_lyrics.py.

Run: python3 tests/test_align_text.py
Dependency-free by design — no pytest, no torch.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

from align_lyrics import lyric_lines, regroup_spans_into_lines  # noqa: E402


def test_masked_token_keeps_its_slot():
    lines = lyric_lines("keeping these **** right here")
    assert lines == [["keeping", "these", "****", "right", "here"]], lines


def test_ordinary_punctuation_still_dropped():
    assert lyric_lines("hello --- world") == [["hello", "world"]]


def test_section_markers_still_dropped():
    assert lyric_lines("[Verse 1]\nreal words here") == [["real", "words", "here"]]


def test_masked_token_emitted_without_consuming_a_span():
    lines = [["keeping", "these", "****", "right", "here"]]
    spans = [
        {"word": "keeping", "start": 0.0, "end": 0.5},
        {"word": "these", "start": 0.5, "end": 1.0},
        {"word": "right", "start": 1.5, "end": 2.0},
        {"word": "here", "start": 2.0, "end": 2.5},
    ]
    segs = regroup_spans_into_lines(spans, lines)
    got = [w["word"] for w in segs[0]["words"]]
    assert got == ["keeping", "these", "****", "right", "here"], got
    by_word = {w["word"]: w for w in segs[0]["words"]}
    # The mask must not steal the next word's timing.
    assert by_word["right"]["start"] == 1.5, by_word["right"]
    assert by_word["****"]["start"] == 1.0, by_word["****"]


def test_line_with_no_matching_spans_is_dropped():
    assert regroup_spans_into_lines([], [["nothing", "matches"]]) == []


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"  ok   {name}")
        except AssertionError as e:
            failures += 1
            print(f"  FAIL {name}: {e}")
    print(f"\n{'FAILED' if failures else 'passed'} ({failures} failure(s))")
    sys.exit(1 if failures else 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 tests/test_align_text.py`
Expected: FAIL — `test_masked_token_keeps_its_slot` finds the mask missing.

- [ ] **Step 3: Write the implementation**

In `scripts/align_lyrics.py`, add below `WORD_RE` (line 31):

```python
# A fully-masked word from a censored source. It carries no sound to align, but
# it must keep its slot so the line does not silently lose a word.
MASK_RE = re.compile(r"^\*{2,}$")
```

Change `lyric_lines` line 45 from:

```python
        tokens = [t for t in raw.split() if WORD_RE.search(t)]
```

to:

```python
        tokens = [t for t in raw.split() if WORD_RE.search(t) or MASK_RE.match(t)]
```

In `regroup_spans_into_lines`, replace the token loop body (lines 64–80) with:

```python
        for tok in tokens:
            if MASK_RE.match(tok):
                # Nothing to align against. Pin it where the previous word
                # ended so the line keeps its shape; sanitize() gives it a
                # minimum duration afterwards.
                at = words[-1]["end"] if words else (spans[si]["start"] if si < len(spans) else 0.0)
                words.append({"word": tok, "start": at, "end": at})
                continue

            key = norm(tok)
            if not key:
                continue
            # Consume aligner spans until this lyric token is covered.
            acc, matched = "", []
            while si < len(spans) and len(acc) < len(key):
                acc += norm(spans[si]["word"])
                matched.append(spans[si])
                si += 1
            if not matched:
                continue
            words.append({
                "word": tok,
                "start": matched[0]["start"],
                "end": matched[-1]["end"],
            })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 tests/test_align_text.py`
Expected: PASS (5 tests)

- [ ] **Step 5: Confirm the windowing tests still pass**

Run: `python3 tests/test_align_windowing.py`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add scripts/align_lyrics.py tests/test_align_text.py
git commit -m "fix(align): keep masked words in the line instead of dropping them"
```

---

### Task 6: Anchored alignment

The centrepiece. Align each line inside its own known window instead of walking the track blind.

**Files:**
- Modify: `scripts/align_lyrics.py` (add after `walk_windows`)
- Test: `tests/test_align_anchored.py` (create)

**Interfaces:**
- Consumes: `WORD_RE`, `MASK_RE`, `norm`, `regroup_spans_into_lines`, `sanitize` — all existing in the module.
- Produces: `ANCHOR_PAD`, `align_anchored(anchors, audio_end, align_line)`. Task 7 calls it from `run_anchored`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_align_anchored.py`:

```python
#!/usr/bin/env python3
"""Anchored alignment contract for scripts/align_lyrics.py.

Run: python3 tests/test_align_anchored.py

The property that matters: a line's words cannot leave that line's own window,
so the collapse that windowing suffered is structurally impossible here.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

from align_lyrics import ANCHOR_PAD, align_anchored  # noqa: E402

TRACK = 161.99
# 16 lines of 4 words, one every 10s — the shape of a real 2:42 track.
ANCHORS = [
    {"text": f"alpha bravo charlie delta{i}", "start": i * 10.0, "end": i * 10.0 + 4.0}
    for i in range(16)
]


def collapsing_line(lo, hi, tokens):
    """The failure mode from windowing: every token stamped at the head."""
    return [(t, 0.001 * i, 0.001 * i + 0.05) for i, t in enumerate(tokens)]


def healthy_line(lo, hi, tokens):
    step = (hi - lo) / max(1, len(tokens))
    return [(t, i * step, (i + 1) * step) for i, t in enumerate(tokens)]


def all_words(segments):
    return [w for s in segments or [] for w in s["words"]]


def test_words_stay_inside_their_own_anchor_window():
    for aligner in (collapsing_line, healthy_line):
        segs = align_anchored(ANCHORS, TRACK, aligner)
        assert segs, f"{aligner.__name__}: produced nothing"
        for anchor, seg in zip(ANCHORS, segs):
            lo = max(0.0, anchor["start"] - ANCHOR_PAD)
            hi = min(TRACK, anchor["end"] + ANCHOR_PAD)
            for w in seg["words"]:
                assert lo - 1e-6 <= w["start"] <= hi + 1e-6, (
                    f"{aligner.__name__}: {w['word']} at {w['start']:.2f} outside [{lo:.2f},{hi:.2f}]"
                )


def test_a_collapsing_aligner_cannot_compress_the_track():
    """The exact bug: 537 words inside 3.7s of a 162s track. Anchors forbid it."""
    segs = align_anchored(ANCHORS, TRACK, collapsing_line)
    words = all_words(segs)
    assert words[-1]["end"] > 140, f"track compressed to {words[-1]['end']:.1f}s"


def test_every_line_keeps_its_words():
    segs = align_anchored(ANCHORS, TRACK, healthy_line)
    assert len(segs) == len(ANCHORS)
    for anchor, seg in zip(ANCHORS, segs):
        assert len(seg["words"]) == len(anchor["text"].split())


def test_unusable_anchors_are_skipped_not_faked():
    bad = [
        {"text": "kept words here", "start": 1.0, "end": 4.0},
        {"text": "zero width", "start": 9.0, "end": 9.0},
        {"text": "", "start": 20.0, "end": 24.0},
    ]
    segs = align_anchored(bad, TRACK, healthy_line)
    assert len(segs) == 1, segs


def test_returns_none_when_nothing_aligns():
    assert align_anchored([], TRACK, healthy_line) is None


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"  ok   {name}")
        except AssertionError as e:
            failures += 1
            print(f"  FAIL {name}: {e}")
    print(f"\n{'FAILED' if failures else 'passed'} ({failures} failure(s))")
    sys.exit(1 if failures else 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 tests/test_align_anchored.py`
Expected: FAIL — `ImportError: cannot import name 'ANCHOR_PAD'`

- [ ] **Step 3: Write the implementation**

In `scripts/align_lyrics.py`, add after `walk_windows`:

```python
# A synced source's timings come from a different master than the local file, so
# give each line room on both sides rather than trusting them to the millisecond.
ANCHOR_PAD = 0.6
# Below this a window is too short to align anything meaningful in.
MIN_ANCHOR_WINDOW = 0.15


def align_anchored(anchors, audio_end, align_line):
    """Align each lyric line inside its own known time window.

    `anchors` is [{"text": str, "start": float, "end": float}] — line-level
    timings from a synced source such as LRCLIB. `align_line(lo, hi, tokens)`
    returns (text, start, end) triples with times relative to `lo`.

    This is structurally immune to the collapse that windowing suffers: a line's
    words cannot leave that line's slice of audio, so the token stream can never
    outrun the audio cursor. It also keeps every clip far below the encoder's
    ~30s ceiling without any windowing machinery at all.

    A line that aligns to nothing is skipped rather than invented.
    """
    segments = []

    for anchor in anchors or []:
        tokens = [
            t for t in str(anchor.get("text", "")).split()
            if WORD_RE.search(t) or MASK_RE.match(t)
        ]
        if not tokens:
            continue

        try:
            lo = max(0.0, float(anchor["start"]) - ANCHOR_PAD)
            hi = min(float(audio_end), float(anchor["end"]) + ANCHOR_PAD)
        except (KeyError, TypeError, ValueError):
            continue
        if hi - lo < MIN_ANCHOR_WINDOW:
            continue

        spans = []
        for text, start, end in align_line(lo, hi, tokens):
            if not norm(text):
                continue
            spans.append({
                "word": text,
                "start": lo + float(start),
                "end": lo + float(end),
            })

        segments.extend(regroup_spans_into_lines(spans, [tokens]))

    if not segments:
        return None
    return sanitize(segments, audio_end)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 tests/test_align_anchored.py`
Expected: PASS (5 tests)

- [ ] **Step 5: Confirm the other Python tests still pass**

Run: `python3 tests/test_align_windowing.py && python3 tests/test_align_text.py`
Expected: PASS (4 and 5 tests)

- [ ] **Step 6: Commit**

```bash
git add scripts/align_lyrics.py tests/test_align_anchored.py
git commit -m "feat(align): anchor alignment to known line windows"
```

---

### Task 7: Wire anchors through the CLI and the job runner

**Files:**
- Modify: `scripts/align_lyrics.py:484-523` (argparse and dispatch), plus a new `run_anchored`
- Modify: `src/main/lyrics/autoAligner.js:151-178` (`runAligner`) and `:191-238` (`triggerAutoAlignment`)

**Interfaces:**
- Consumes: `align_anchored` from Task 6; `anchors` passed by Task 3.
- Produces: `--anchors <path>` CLI flag; `triggerAutoAlignment({..., anchors})`.

- [ ] **Step 1: Add the Python entry point**

In `scripts/align_lyrics.py`, add beside `run_forced`:

```python
def run_anchored(audio_path, anchors, language, device, dtype_name):
    """Forced alignment with known line windows. See align_anchored."""
    import torch
    import whisperx
    from qwen_asr import Qwen3ForcedAligner

    audio = whisperx.load_audio(audio_path)
    audio_end = len(audio) / SAMPLE_RATE
    dtype = {"float32": torch.float32, "float16": torch.float16, "bfloat16": torch.bfloat16}[dtype_name]

    print(
        f"[align] anchored: device={device} dtype={dtype_name} lines={len(anchors)} "
        f"audio={audio_end:.0f}s",
        file=sys.stderr,
    )
    model = Qwen3ForcedAligner.from_pretrained(
        "Qwen/Qwen3-ForcedAligner-0.6B", dtype=dtype, device_map=device
    )

    def align_line(lo, hi, tokens):
        clip = audio[int(lo * SAMPLE_RATE):int(hi * SAMPLE_RATE)]
        try:
            results = model.align(audio=(clip, SAMPLE_RATE), text=" ".join(tokens), language=language)
            items = list(results[0])
        except Exception as e:
            print(f"[align] line {lo:.1f}-{hi:.1f}s failed: {e}", file=sys.stderr)
            return []
        return [
            (
                getattr(it, "text", "") or "",
                float(getattr(it, "start_time", 0.0) or 0.0),
                float(getattr(it, "end_time", 0.0) or 0.0),
            )
            for it in items
        ]

    segments = align_anchored(anchors, audio_end, align_line)
    print(
        f"[align] anchored: {len(segments or [])} of {len(anchors)} lines aligned",
        file=sys.stderr,
    )
    return segments
```

- [ ] **Step 2: Add the CLI flag and dispatch**

In `main()`, after `ap.add_argument("--lyrics", ...)` (line 488) add:

```python
    ap.add_argument("--anchors", help="JSON file of [{text,start,end}] line windows")
```

Then change the dispatch. The current block at line 502 begins `if args.lyrics:`. Insert this *before* it:

```python
    anchors = None
    if args.anchors:
        try:
            with open(args.anchors, "r", encoding="utf-8") as fh:
                anchors = json.load(fh)
        except Exception as e:
            print(f"[align] could not read anchors, falling back: {e}", file=sys.stderr)
            anchors = None

    segments = None
    if anchors:
        segments = run_anchored(args.audio, anchors, args.language, args.device, args.dtype)
        if not segments:
            print("[align] anchored pass produced nothing, falling back", file=sys.stderr)

    if segments:
        pass
    elif args.lyrics:
```

and change the existing `if args.lyrics:` line to be consumed by that `elif`. The remaining branches are unchanged.

- [ ] **Step 3: Pass the anchors file from the job runner**

In `src/main/lyrics/autoAligner.js`, change `runAligner`'s signature and args:

```js
function runAligner({ audioPath, lyricsPath, anchorsPath, outPath }) {
```

and after the existing `if (lyricsPath) args.push("--lyrics", lyricsPath);`:

```js
    if (anchorsPath) args.push("--anchors", anchorsPath);
```

- [ ] **Step 4: Write the anchors file in `triggerAutoAlignment`**

Change the signature (line 191):

```js
export async function triggerAutoAlignment({ name, artist, duration, position = 0, lyricsText = "", anchors = [] }) {
```

After the existing lyrics-file write (line 237–238), add:

```js
  // Line windows from a synced source. Their presence switches the aligner to
  // the anchored path, which cannot collapse.
  const anchorsPath = anchors?.length ? path.join(WORK_DIR, `${key}.anchors.json`) : null;
  if (anchorsPath) fs.writeFileSync(anchorsPath, JSON.stringify(anchors), "utf8");
```

Update the log on line 243 from:

```js
    lyricsPath ? "(forced alignment)" : "(ASR)",
```

to:

```js
    anchorsPath ? "(anchored)" : lyricsPath ? "(forced alignment)" : "(ASR)",
```

And the call site (line 260):

```js
      const aligned = await runAligner({ audioPath, lyricsPath, anchorsPath, outPath: outJson });
```

- [ ] **Step 5: Verify the script still parses and the suites pass**

Run:

```bash
python3 -m py_compile scripts/align_lyrics.py && echo "compiles OK"
python3 tests/test_align_anchored.py && python3 tests/test_align_windowing.py && python3 tests/test_align_text.py
npx vitest run
```

Expected: compiles OK, all Python tests pass, 94 JS tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/align_lyrics.py src/main/lyrics/autoAligner.js
git commit -m "feat(align): wire line anchors through the CLI and job runner"
```

---

### Task 8: Regenerate Hard Knock and verify the whole Part A chain

Manual verification. This is a **hard gate** — if anything fails, stop. Do not start Part B and do not regenerate other tracks.

**Files:**
- Produces: `~/.sweetly-custom/hard_knock_slayr.ttml` (overwritten)

- [ ] **Step 1: Move the corrupt file aside**

Keep it as the comparison baseline.

```bash
mv ~/.sweetly-custom/hard_knock_slayr.ttml /tmp/hard_knock_slayr.OLD.ttml
```

- [ ] **Step 2: Confirm the audio route is live**

```bash
system_profiler SPAudioDataType | grep -A2 -i "blackhole"
```

Expected: BlackHole 2ch present. If absent, capture records silence — fix audio routing before continuing.

- [ ] **Step 3: Run the app and play the track from 0:00**

```bash
npm run dev
```

Play "Hard Knock" by slayr from the very start. Watch for:
`Alignment target: lrclib (N anchored lines)` then `[align] anchored: … lines=N audio=162s` then `[align] anchored: N of N lines aligned`.

Capture takes 2:42; alignment follows.

- [ ] **Step 4: Verify the regenerated file**

```bash
node --input-type=module -e "
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const { parseTtmlXmlToJson } = await import('./src/main/lyrics/ttmlXml.js');
const { lyricsCoverTrack, isCensored } = await import('./src/main/lyrics/utils.js');
const p = parseTtmlXmlToJson(fs.readFileSync(path.join(os.homedir(),'.sweetly-custom/hard_knock_slayr.ttml'),'utf8'));
let syl=0, first=Infinity, last=0;
for (const l of p.Content) for (const g of [l.Lead,l.Background]) { if(!g) continue;
  for (const s of g.Syllables||[]) { syl++; first=Math.min(first,s.StartTime); last=Math.max(last,s.EndTime); } }
const text = p.Content.map(l=>(l.Lead?.Syllables||[]).map(s=>s.Text).join(' ')).join('\n');
console.log('lines:', p.Content.length, 'syllables:', syl);
console.log('span:', first.toFixed(1)+'s ->', last.toFixed(1)+'s of 162s');
console.log('words/sec:', (syl/(last-first)).toFixed(1));
console.log('passes guard:', lyricsCoverTrack(p, 161.99));
console.log('censored:', isCensored(text));
process.exit(0);
" 2>&1 | grep -vE "AppleMusicAPI|Sweetly-Main"
```

Expected: `passes guard: true`, `censored: false`, words/sec under 12, span reaching past ~140s, syllables well above the line count.

- [ ] **Step 5: Sanity-check the sync by ear**

Play the track in the app. Words should land on the vocal, not merely drift near it. If the whole track is uniformly early or late, that is a global offset (LRCLIB's master differs) — note it, it is correctable, and it is not a collapse.

---

### Task 9: Contrast, scale and bloom override stylesheet

**Files:**
- Create: `src/renderer/styles/punch.css`
- Modify: `src/renderer/main.ts:23` (import after the upstream stylesheet imports)

**Interfaces:**
- Produces: `--punch-scale`, `--punch-bloom` consumed by Task 10.

- [ ] **Step 1: Create the stylesheet**

Create `src/renderer/styles/punch.css`:

```css
/*
 * Sweetly's punch layer. Loaded after upstream so it wins on equal specificity.
 * Upstream files are never edited — see CLAUDE.md on the vendored fork.
 *
 * Values are tuned by eye. The alpha pair is carried from upstream's own
 * SimpleLyricsMode, which already ships 1 / 0.3 and reads far crisper than the
 * 0.85 / 0.5 default.
 */

#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line,
#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line .word,
#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line .letter {
  --gradient-alpha: 1;
  --gradient-alpha-end: 0.22;
}

/* A scrim so text stops competing with the Kawarp background. */
#SpicyLyricsPage.SpicyRenderer .LyricsContainer::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.28) 22%, rgba(0,0,0,0.38) 100%);
  z-index: 0;
}

#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent {
  position: relative;
  z-index: 1;
}

/* Bloom on the active line only, so contrast does the work. */
#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line.Active,
#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line.Active .word {
  text-shadow:
    0 0 calc(var(--punch-bloom, 1) * 18px) rgba(255, 255, 255, 0.34),
    0 0 calc(var(--punch-bloom, 1) * 44px) rgba(255, 255, 255, 0.16);
}

/* Per-line spring, driven by punchLayer.ts. The defaults keep layout identical
   when the layer has not run, so this stylesheet is safe on its own. */
#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line {
  transform-origin: left center;
  scale: var(--punch-scale, 1);
  transition: scale 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  #SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line {
    scale: 1;
    transition: none;
  }
}
```

- [ ] **Step 2: Import it after the upstream stylesheets**

In `src/renderer/main.ts`, after `import "tippy.js/dist/tippy.css";` (line 23):

```ts
// Sweetly's own overrides. Must load after upstream's Lyrics CSS to win.
import "./styles/punch.css";
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: succeeds, no CSS resolution errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/styles/punch.css src/renderer/main.ts
git commit -m "feat(renderer): contrast, scrim and bloom override for lyrics"
```

---

### Task 10: Per-line spring motion layer

Upstream's `applyScale` (`LyricsAnimator.ts:610-638`) is commented out, so `--scale-amount` is never written and no line has ever scaled. This adds it host-side, writing its own property — upstream's contract assigns `0` to the active line, which would collapse it, and is deliberately not revived.

**Files:**
- Create: `src/renderer/lyrics/punchLayer.ts`
- Modify: `src/renderer/main.ts` (start the layer inside `start()`)

**Interfaces:**
- Consumes: `--punch-scale`, `--punch-bloom` from Task 9.
- Produces: `startPunchLayer(): () => void` — returns a disposer.

- [ ] **Step 1: Write the module**

Create `src/renderer/lyrics/punchLayer.ts`:

```ts
/**
 * Per-line motion for the lyrics view.
 *
 * Upstream ships this capability commented out (`applyScale` in
 * LyricsAnimator.ts), so no line has ever scaled. Rather than revive that code
 * — it assigns 0 to the active line, which would collapse it — this watches
 * class transitions and writes its own custom properties.
 *
 * Everything is a CSS custom property so the stylesheet owns the easing and a
 * reduced-motion user gets a static view for free.
 */

const PAGE_SELECTOR = "#SpicyLyricsPage";
const ACTIVE_SCALE = 1.045;
const REST_SCALE = 1;
/** Lines further than this from the active one stop softening further. */
const MAX_DISTANCE = 6;

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Push scale onto the active line and depth blur onto the rest by distance. */
function paint(lines: HTMLElement[]): void {
  const activeIndex = lines.findIndex((el) => el.classList.contains("Active"));

  lines.forEach((el, i) => {
    const isActive = i === activeIndex;
    el.style.setProperty("--punch-scale", isActive ? `${ACTIVE_SCALE}` : `${REST_SCALE}`);
    el.style.setProperty("--punch-bloom", isActive ? "1" : "0");

    if (activeIndex < 0) {
      el.style.removeProperty("--BlurAmount");
      return;
    }
    // Upstream already consumes --BlurAmount in its text-shadow, so depth
    // rides that existing channel rather than adding a filter.
    const distance = Math.min(Math.abs(i - activeIndex), MAX_DISTANCE);
    el.style.setProperty("--BlurAmount", `${distance * 0.9}px`);
  });
}

/**
 * Start watching the lyrics page. Safe to call before lyrics exist — it waits
 * for the container and re-attaches when ApplyLyrics replaces the content.
 */
export function startPunchLayer(): () => void {
  if (prefersReducedMotion()) return () => {};

  let contentObserver: MutationObserver | null = null;

  const attach = (content: HTMLElement) => {
    contentObserver?.disconnect();
    const repaint = () => paint(Array.from(content.querySelectorAll<HTMLElement>(".line")));
    contentObserver = new MutationObserver(repaint);
    contentObserver.observe(content, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
      childList: true,
    });
    repaint();
  };

  // ApplyLyrics rebuilds .LyricsContent wholesale, so watch the page for it.
  const pageObserver = new MutationObserver(() => {
    const content = document.querySelector<HTMLElement>(
      `${PAGE_SELECTOR} .LyricsContainer .LyricsContent`,
    );
    if (content && !content.dataset.punchAttached) {
      content.dataset.punchAttached = "1";
      attach(content);
    }
  });
  pageObserver.observe(document.body, { childList: true, subtree: true });

  const existing = document.querySelector<HTMLElement>(
    `${PAGE_SELECTOR} .LyricsContainer .LyricsContent`,
  );
  if (existing) {
    existing.dataset.punchAttached = "1";
    attach(existing);
  }

  return () => {
    pageObserver.disconnect();
    contentObserver?.disconnect();
  };
}
```

- [ ] **Step 2: Start it from the entry point**

In `src/renderer/main.ts`, inside `start()`, after the `IntervalManager` block that drives `ScrollToActiveLine` (around line 126):

```ts
  const { startPunchLayer } = await import("./lyrics/punchLayer.ts");
  startPunchLayer();
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Verify by eye**

Run `npm run dev` and play the regenerated track. The active line should scale up slightly and settle; distant lines should soften progressively.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lyrics/punchLayer.ts src/renderer/main.ts
git commit -m "feat(renderer): per-line spring and depth blur for lyrics"
```

---

### Task 11: Split line-level lyrics into words

A line-level `<p>` becomes a single syllable (`ttmlXml.js:212`), so it gets none of the per-word machinery and renders as one smeared gradient.

Interpolated word times are evenly spaced guesses. They read smooth but land off-syllable — a fallback for tracks with no real alignment, not a substitute for one.

**Files:**
- Modify: `src/main/lyrics/ttmlXml.js:210-213`
- Test: `tests/lyrics/lineSplitting.test.ts` (create)

**Interfaces:**
- Consumes: `splitLineToSyllables(text, startTime, endTime)` — already exported from `src/main/lyrics/utils.js:18`.
- Produces: no signature change to `parseTtmlXmlToJson(xml)`.

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/lineSplitting.test.ts`:

```ts
import { describe, it, expect } from "vitest";
// @ts-expect-error - main/ is plain JS with no type declarations
import { parseTtmlXmlToJson } from "../../src/main/lyrics/ttmlXml.js";

const LINE_LEVEL = `<tt xmlns="http://www.w3.org/ns/ttml" itunes:timing="Line" xml:lang="en">
<body dur="00:00:10.000"><div>
<p begin="00:00:01.000" end="00:00:05.000">one two three four</p>
</div></body></tt>`;

describe("line-level TTML", () => {
  it("splits a line into per-word syllables so the renderer can animate it", () => {
    const parsed = parseTtmlXmlToJson(LINE_LEVEL);
    const syllables = parsed.Content[0].Lead.Syllables;
    expect(syllables.map((s: any) => s.Text)).toEqual(["one", "two", "three", "four"]);
  });

  it("spreads the word timings across the line's own span", () => {
    const parsed = parseTtmlXmlToJson(LINE_LEVEL);
    const syllables = parsed.Content[0].Lead.Syllables;
    expect(syllables[0].StartTime).toBeCloseTo(1.0, 3);
    expect(syllables[3].EndTime).toBeCloseTo(5.0, 3);
    for (let i = 1; i < syllables.length; i++) {
      expect(syllables[i].StartTime).toBeGreaterThanOrEqual(syllables[i - 1].EndTime - 1e-6);
    }
  });

  it("keeps the line's own start and end untouched", () => {
    const parsed = parseTtmlXmlToJson(LINE_LEVEL);
    expect(parsed.Content[0].Lead.StartTime).toBeCloseTo(1.0, 3);
    expect(parsed.Content[0].Lead.EndTime).toBeCloseTo(5.0, 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lyrics/lineSplitting.test.ts`
Expected: FAIL — one syllable containing the whole line.

- [ ] **Step 3: Write the implementation**

In `src/main/lyrics/ttmlXml.js`, add the import beside the existing ones:

```js
import { splitLineToSyllables } from "./utils.js";
```

Find the `const plainText = cleanText(pContent);` line and the `lines.push(...)` below it that builds a single syllable. Replace that push with:

```js
      // A line-level <p> has no <span> children, so upstream's per-word
      // animation has nothing to attach to and the line renders as one smeared
      // gradient. Split it so every word gets an element. These timings are
      // interpolated — a fallback for tracks with no real alignment.
      const syllables = splitLineToSyllables(plainText, lead.StartTime, lead.EndTime);
      lines.push({
        Lead: {
          StartTime: lead.StartTime,
          EndTime: lead.EndTime,
          Syllables: syllables.length
            ? syllables
            : [{ Text: plainText, StartTime: lead.StartTime, EndTime: lead.EndTime, IsPartOfWord: false }],
        },
        OppositeAligned: false,
      });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lyrics/lineSplitting.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Confirm nothing regressed**

Run: `npx vitest run`
Expected: PASS — 97 tests. Watch `tests/lyrics/toSpicyShape.test.ts`, which also exercises TTML parsing.

- [ ] **Step 6: Commit**

```bash
git add src/main/lyrics/ttmlXml.js tests/lyrics/lineSplitting.test.ts
git commit -m "feat(lyrics): split line-level TTML into per-word syllables"
```

---

### Task 12: Regenerate the remaining collapsed tracks

Only after Tasks 1–11 are verified. Eight tracks, one capture each at full length — roughly 30 minutes of wall time, not parallelisable (each needs exclusive audio).

- [ ] **Step 1: List what still fails the guard**

```bash
node --input-type=module -e "
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const { parseTtmlXmlToJson } = await import('./src/main/lyrics/ttmlXml.js');
const { lyricsCoverTrack } = await import('./src/main/lyrics/utils.js');
const dir = path.join(os.homedir(),'.sweetly-custom');
for (const f of fs.readdirSync(dir).filter(f=>/\.ttml\$/i.test(f))) {
  let p=null; try { p=parseTtmlXmlToJson(fs.readFileSync(path.join(dir,f),'utf8')); } catch {}
  if (!p?.Content?.length) { console.log('EMPTY    ', f); continue; }
  if (!lyricsCoverTrack(p, 0)) console.log('COLLAPSED', f);
}
process.exit(0);
" 2>&1 | grep -vE "AppleMusicAPI|Sweetly-Main"
```

- [ ] **Step 2: Regenerate each**

For each: move it aside to `/tmp`, play that track from 0:00, wait for the `[align] anchored:` completion line.

**Marisa Stole the Precious Thing has neither Apple nor LRCLIB coverage.** It gets no anchors and no text target, so it runs the ASR path and will be the weakest result. Expect to accept it as-is or leave the track unaligned.

- [ ] **Step 3: Verify each with the Task 8 Step 4 script**

Substitute the filename and real duration. Every file must report `passes guard: true` and words/sec under 12.

- [ ] **Step 4: Commit nothing**

These live in `~/.sweetly-custom`, outside the repo.

---

## Self-Review

**Spec coverage:**
- A1 uncensored target → Tasks 1, 3. A1 "preserve masked as literal" → Task 5.
- A2 ad-lib rule → Task 4.
- A3 regenerate → Tasks 8, 12.
- B1 stylesheet → Task 9. B2 motion layer → Task 10. B3 synthesized words → Task 11.
- Out of scope (beat response) → correctly absent.

**Deviations from the spec, recorded:**
1. The spec did not notice that `fetcher.js` triggers the aligner *before* fetching LRCLIB. Task 3 hoists it; without this A1 cannot work at all.
2. **Anchored alignment (Tasks 2, 6, 7) is new** and was not in the approved spec. It supersedes the spec's implicit assumption that windowing stays the mechanism. It was added because measurement showed Apple has no word-level timings anywhere in this library, making LRCLIB's line windows the only structural constraint available — and one that makes the collapse impossible rather than merely detected. The windowing path in `walk_windows` is retained as the fallback for tracks with no synced source.

**Type consistency:** `pickAlignmentText` returns `{source, text} | null`; Task 3 reads `alignTarget?.text` / `alignTarget?.source`. `toLineAnchors` returns `{text, start, end}[]`, matching what `align_anchored` reads in Python. `align_anchored(anchors, audio_end, align_line)` matches its call in `run_anchored`. `runAligner({audioPath, lyricsPath, anchorsPath, outPath})` matches its call site. `startPunchLayer()` takes no arguments.

**Placeholder scan:** no TBD/TODO; every code step carries real code.
