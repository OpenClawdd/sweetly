# Punchy Lyrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lyrics view hit hard — by first fixing the content bugs that corrupt aligned lyrics, then adding the per-line motion and contrast the renderer currently lacks.

**Architecture:** Part A fixes the data going in: pick an uncensored alignment target, stop the ad-lib regex relocating ordinary words, and preserve masked tokens so lines keep their shape. Part B adds a host-side CSS override plus a motion layer that drives per-line spring physics — a capability upstream commented out. Part B also splits line-level lyrics into words so tracks without real word data still animate.

**Tech Stack:** Node ESM (`src/main/`), TypeScript (`src/renderer/`), Python 3 (`scripts/`), vitest, plain CSS.

## Global Constraints

- **Never edit anything under `src/` except `main/`, `preload/` and `renderer/`.** `src/` is a vendored AGPL fork of Spicy Lyrics 6.2.3. `src/components/`, `src/css/`, `src/utils/` are off limits. Every task here respects this.
- Renderer makes no direct network requests — everything routes through the main process over IPC.
- `main/` and `preload/` are `.js`; `renderer/` is `.ts`. All ESM.
- Use `npm`, not `bun`. Tests are vitest, not `bun test`.
- Apple Music reports **seconds**; parsed TTML timings are in **seconds**.
- Run JS tests with `npx vitest run <path>`; Python tests with `python3 <path>`.

## File Structure

**Part A (content correctness)**
- `src/main/lyrics/utils.js` — add `isCensored()` and `pickAlignmentText()` beside the existing `lyricsCoverTrack()`. Pure functions, no I/O.
- `src/main/lyrics/fetcher.js` — hoist the LRCLIB fetch above the aligner trigger; feed the chosen text to the aligner.
- `src/main/lyrics/autoAligner.js` — narrow the ad-lib rule in `convertAlignedJsonToTTML`.
- `scripts/align_lyrics.py` — preserve masked tokens through `lyric_lines` and `regroup_spans_into_lines`.
- `tests/lyrics/alignmentText.test.ts` — new, covers `isCensored` / `pickAlignmentText`.
- `tests/lyrics/adlibs.test.ts` — new, covers `convertAlignedJsonToTTML` classification.
- `tests/test_align_text.py` — new, covers masked-token preservation.

**Part B (punch)**
- `src/renderer/styles/punch.css` — new. Contrast, type scale, scrim, bloom, blur falloff.
- `src/renderer/lyrics/punchLayer.ts` — new. Per-line spring driven by class transitions.
- `src/renderer/main.ts` — import the stylesheet, start the punch layer.
- `src/main/lyrics/ttmlXml.js` — split line-level `<p>` text into per-word syllables.
- `tests/lyrics/lineSplitting.test.ts` — new, covers the split.

---

### Task 1: Censorship detection and alignment-target selection

Apple returns fully-masked words for some tracks. `norm()` in `align_lyrics.py` reduces `****` to the empty string, so the word is dropped and the line loses a slot. Pick a cleaner source when one exists.

**Files:**
- Modify: `src/main/lyrics/utils.js` (append after `lyricsCoverTrack`)
- Test: `tests/lyrics/alignmentText.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `isCensored(text: string): boolean` and `pickAlignmentText(candidates: Array<{source: string, text: string}>): {source: string, text: string} | null` — Task 2 wires these into `fetcher.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/alignmentText.test.ts`:

```ts
import { describe, it, expect } from "vitest";
// @ts-expect-error - main/ is plain JS with no type declarations
import { isCensored, pickAlignmentText } from "../../src/main/lyrics/utils.js";

describe("isCensored", () => {
  it("detects runs of two or more asterisks", () => {
    expect(isCensored("sweeping these **** right up")).toBe(true);
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
 * release is matched. `norm()` in align_lyrics.py reduces `****` to the empty
 * string, so a masked word is dropped rather than voiced — the stored TTML
 * ends up a word short and the line loses its shape. Prefer a source that
 * still has the word.
 *
 * Candidates are considered in the order given, so callers should list their
 * preferred source first. When every candidate is masked, the least-masked one
 * wins: fewer holes is strictly better than more.
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

### Task 2: Feed the aligner the chosen text

`fetcher.js` currently passes Apple's text to the aligner at line 94, but does not fetch LRCLIB until line 109 — after the aligner has already been triggered. The LRCLIB fetch must be hoisted so its text is available in time.

**Files:**
- Modify: `src/main/lyrics/fetcher.js`

**Interfaces:**
- Consumes: `pickAlignmentText` from Task 1.
- Produces: no new exports. Behaviour change only.

- [ ] **Step 1: Add the import**

In `src/main/lyrics/fetcher.js`, the file currently has no import from `./utils.js`. Add one after the existing source imports at the top:

```js
import { pickAlignmentText } from "./utils.js";
```

- [ ] **Step 2: Hoist the LRCLIB fetch above the aligner trigger**

Find this block (currently around lines 85–113):

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
  // aligner needs its text: Apple masks words on some tracks, and a masked
  // word is dropped rather than voiced, leaving a hole in the line.
  const lrcLib = await safe("lrclib", () => fetchLRCLib(name, artist));

  // Nothing word-level exists anywhere. Capture the audio as it plays and
  // derive timings, using the cleanest untimed text we have as the target so
  // the aligner never has to guess the words.
  const alignTarget = pickAlignmentText([
    { source: "lrclib", text: lyricsToPlainText(lrcLib) },
    { source: "apple", text: lyricsToPlainText(appleLyrics) },
  ]);
  if (alignTarget) {
    console.log("[Sweetly-Main] Alignment target text from:", alignTarget.source);
  }

  const alignResult = await safe("auto-aligner", () =>
    triggerAutoAlignment({
      name,
      artist,
      duration: playback.duration,
      position: playback.position ?? 0,
      lyricsText: alignTarget?.text ?? "",
    }),
  );
```

LRCLIB is listed first because it carries uncensored text where Apple does not.

- [ ] **Step 3: Remove the now-duplicated LRCLIB fetch**

Further down, find:

```js
  // 6. LRCLIB (line-level LRC), then Genius (plain text)
  const lrcLib = await safe("lrclib", () => fetchLRCLib(name, artist));
  if (lrcLib) {
```

Replace with (the fetch is gone; the variable is already in scope):

```js
  // 6. LRCLIB (line-level LRC), then Genius (plain text).
  // Already fetched above, because the aligner needed its text.
  if (lrcLib) {
```

- [ ] **Step 4: Verify the whole suite still passes**

Run: `npx vitest run`
Expected: PASS — 86 tests, same as before. This task changes ordering, not results.

- [ ] **Step 5: Verify against the real track**

Run:

```bash
node --input-type=module -e "
const { fetchLRCLib } = await import('./src/main/lyrics/sources/lrclib.js');
const { findAppleMusicLyrics } = await import('./src/main/appleMusicApi.js');
const { pickAlignmentText, isCensored } = await import('./src/main/lyrics/utils.js');
const flat = (d) => !d?.Content ? '' : d.Content.map(l=>(l.Lead?.Syllables||[]).map(s=>s.Text).join('')).join('\n');
const apple = (await findAppleMusicLyrics('Hard Knock','slayr','Half Blood (BloodLuxe)'))?.lyrics;
const lrc = await fetchLRCLib('Hard Knock','slayr');
console.log('apple censored:', isCensored(flat(apple)));
console.log('lrclib censored:', isCensored(flat(lrc)));
console.log('chosen source:', pickAlignmentText([
  {source:'lrclib', text:flat(lrc)}, {source:'apple', text:flat(apple)}
])?.source);
process.exit(0);
" 2>&1 | grep -vE "AppleMusicAPI|Sweetly-Main"
```

Expected: `apple censored: true`, `lrclib censored: false`, `chosen source: lrclib`

- [ ] **Step 6: Commit**

```bash
git add src/main/lyrics/fetcher.js
git commit -m "fix(lyrics): align against uncensored text, hoisting the LRCLIB fetch"
```

---

### Task 3: Stop the ad-lib rule eating ordinary words

`autoAligner.js:87` lists `pop`, `yeah`, `oh`, `ha`, `gang` as interjections and `:119` tests every token against it, so any standalone occurrence is moved into a background `x-bg` span. An ordinary lyric containing the word "pop" loses it from the lead line.

**Files:**
- Modify: `src/main/lyrics/autoAligner.js:112-133`
- Test: `tests/lyrics/adlibs.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no signature change. `convertAlignedJsonToTTML(rawJson, artistName, offsetSeconds)` keeps its shape.

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/adlibs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
// @ts-expect-error - main/ is plain JS with no type declarations
import { convertAlignedJsonToTTML } from "../../src/main/lyrics/autoAligner.js";

/** Build one aligned segment from a list of words, half a second apart. */
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
    // The bug: "pop" is in the INTERJECTIONS list, so it was relocated to
    // background vocals and the lead line lost the word.
    const ttml = convertAlignedJsonToTTML(seg(["I'm", "'bout", "to", "pop", "me", "a", "bean"]));
    expect(lead(ttml)).toBe("I'm 'bout to pop me a bean");
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
Expected: FAIL — the first test reports lead `"I'm 'bout to me a bean"` with `pop` in background.

- [ ] **Step 3: Write the implementation**

In `src/main/lyrics/autoAligner.js`, the loop currently reads:

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

Replace it with:

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

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS — 90 tests

- [ ] **Step 6: Commit**

```bash
git add src/main/lyrics/autoAligner.js tests/lyrics/adlibs.test.ts
git commit -m "fix(lyrics): only treat a lone interjection as an ad-lib"
```

---

### Task 4: Preserve masked tokens so lines keep their shape

When no clean source exists, the masked word should still occupy its slot. Today `lyric_lines` drops it (`WORD_RE` matches nothing in `****`) and `regroup_spans_into_lines` skips it (`norm()` returns empty).

**Files:**
- Modify: `scripts/align_lyrics.py:31-48` and `:51-83`
- Test: `tests/test_align_text.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `MASK_RE` and unchanged signatures for `lyric_lines(text)` and `regroup_spans_into_lines(spans, lines)`.

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
    lines = lyric_lines("sweeping these **** right up")
    assert lines == [["sweeping", "these", "****", "right", "up"]], lines


def test_ordinary_punctuation_still_dropped():
    lines = lyric_lines("hello --- world")
    assert lines == [["hello", "world"]], lines


def test_section_markers_still_dropped():
    assert lyric_lines("[Verse 1]\nreal words here") == [["real", "words", "here"]]


def test_masked_token_emitted_without_consuming_a_span():
    lines = [["sweeping", "these", "****", "right", "up"]]
    spans = [
        {"word": "sweeping", "start": 0.0, "end": 0.5},
        {"word": "these", "start": 0.5, "end": 1.0},
        {"word": "right", "start": 1.5, "end": 2.0},
        {"word": "up", "start": 2.0, "end": 2.5},
    ]
    segs = regroup_spans_into_lines(spans, lines)
    got = [w["word"] for w in segs[0]["words"]]
    assert got == ["sweeping", "these", "****", "right", "up"], got
    # The mask must not steal "right"'s timing.
    by_word = {w["word"]: w for w in segs[0]["words"]}
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
Expected: FAIL — `test_masked_token_keeps_its_slot` reports the mask missing from the token list.

- [ ] **Step 3: Write the implementation**

In `scripts/align_lyrics.py`, add below `WORD_RE` (line 31):

```python
# A fully-masked word from a censored source. It carries no sound to align, but
# it must keep its slot so the line does not silently lose a word.
MASK_RE = re.compile(r"^\*{2,}$")
```

Change `lyric_lines` (line 45) from:

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
                # Nothing to align against. Pin it to where the previous word
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

### Task 5: Regenerate Hard Knock and verify the whole Part A chain

This is a manual verification task — it proves the fixed aligner plus the fixed text path produce a good file before 8 more captures are spent.

**Files:**
- Produces: `~/.sweetly-custom/hard_knock_slayr.ttml` (overwritten)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: a verified word-level file. Task 6 onward tunes motion against it.

- [ ] **Step 1: Move the corrupt file aside**

Do not delete it — it is the comparison baseline.

```bash
mv ~/.sweetly-custom/hard_knock_slayr.ttml /tmp/hard_knock_slayr.OLD.ttml
```

- [ ] **Step 2: Confirm the audio route is live**

The aligner captures through BlackHole. Verify the Multi-Output Device is the current output, then:

```bash
system_profiler SPAudioDataType | grep -A2 -i "blackhole"
```

Expected: BlackHole 2ch present. If absent, the capture will produce silence and the alignment will fail — stop and fix audio routing first.

- [ ] **Step 3: Run the app and play the track from the start**

```bash
npm run dev
```

Then play "Hard Knock" by slayr from 0:00. The fetcher finds no word-level source, so it triggers `triggerAutoAlignment` automatically. Watch the terminal for `[align]` lines. Capture takes the length of the track (2:42), alignment ~15s on MPS.

Expected log sequence: `Alignment target text from: lrclib`, then `[align] forced: … tokens=… audio=162s window=26s`, then a span count covering most of 162s.

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
console.log('keeps \'pop\' in a lead line:', /\bpop\b/i.test(text));
process.exit(0);
" 2>&1 | grep -vE "AppleMusicAPI|Sweetly-Main"
```

Expected: `passes guard: true`, `censored: false`, `keeps 'pop' in a lead line: true`, words/sec under 12, span reaching past ~140s.

**If any check fails, stop.** Do not proceed to Part B and do not regenerate other tracks — the pipeline is still wrong and Part B would be tuned against bad data.

- [ ] **Step 5: Commit nothing, record the result**

No repo files change here. Note the verified numbers in the PR/commit message for Task 6.

---

### Task 6: Contrast, scale and bloom override stylesheet

`Mixed.css:44-45` sets sung text to 85% white and unsung to 50%, with no scrim over a saturated animated background. This is a host-owned override loaded after upstream — upstream CSS is not edited.

**Files:**
- Create: `src/renderer/styles/punch.css`
- Modify: `src/renderer/main.ts:23` (import, after the upstream stylesheet imports)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: CSS custom-property overrides consumed by Task 7's motion layer (`--punch-scale`).

- [ ] **Step 1: Create the stylesheet**

Create `src/renderer/styles/punch.css`:

```css
/*
 * Sweetly's punch layer. Loaded after upstream so it wins on equal specificity.
 * Upstream files are never edited — see CLAUDE.md on the vendored fork.
 *
 * Values here are tuned by eye; they are not derived from anything. The alpha
 * pair is carried over from upstream's own SimpleLyricsMode, which already
 * ships 1 / 0.3 and reads far crisper than the 0.85 / 0.5 default.
 */

#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line,
#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line .word,
#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line .letter {
  --gradient-alpha: 1;
  --gradient-alpha-end: 0.22;
}

/* A scrim so text stops competing with the Kawarp background. Sits behind the
   lyrics column only, not the artwork side. */
#SpicyLyricsPage.SpicyRenderer .LyricsContainer::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.28) 22%, rgba(0, 0, 0, 0.38) 100%);
  z-index: 0;
}

#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent {
  position: relative;
  z-index: 1;
}

/* The active line carries a bloom; sung and unsung lines carry none, so the
   contrast between them is doing the work rather than raw brightness. */
#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line.Active,
#SpicyLyricsPage.SpicyRenderer .LyricsContainer .LyricsContent .line.Active .word {
  text-shadow:
    0 0 calc(var(--punch-bloom, 1) * 18px) rgba(255, 255, 255, 0.34),
    0 0 calc(var(--punch-bloom, 1) * 44px) rgba(255, 255, 255, 0.16);
}

/* Per-line spring, driven by punchLayer.ts. Defaults keep the layout identical
   when the layer has not run, so the stylesheet is safe on its own. */
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

In `src/renderer/main.ts`, the stylesheet block ends with `import "tippy.js/dist/tippy.css";` (line 23). Add immediately after it:

```ts
// Sweetly's own overrides. Must load after upstream's Lyrics CSS to win.
import "./styles/punch.css";
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds, no CSS resolution errors.

- [ ] **Step 4: Verify by eye**

Run `npm run dev`, play the regenerated Hard Knock. The active line should read clearly brighter than its neighbours, and the unsung lines noticeably dimmer than before.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/punch.css src/renderer/main.ts
git commit -m "feat(renderer): contrast, scrim and bloom override for lyrics"
```

---

### Task 7: Per-line spring motion layer

Upstream's `applyScale` (`LyricsAnimator.ts:610-638`) is commented out, so `--scale-amount` is never written and there is no per-line pop in any mode. This adds it host-side. It writes `--punch-scale`, its own property — upstream's `--scale-amount` contract is broken (it assigns `0` to the active line, which would collapse it) and is deliberately not revived.

**Files:**
- Create: `src/renderer/lyrics/punchLayer.ts`
- Modify: `src/renderer/main.ts` (start the layer inside `start()`)

**Interfaces:**
- Consumes: `--punch-scale` and `--punch-bloom` from Task 6's stylesheet.
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
 * class transitions and writes its own `--punch-scale` / `--punch-bloom`.
 *
 * Everything is written as a CSS custom property so the stylesheet owns the
 * easing and a reduced-motion user gets a static view for free.
 */

const PAGE_SELECTOR = "#SpicyLyricsPage";
const ACTIVE_SCALE = 1.045;
const REST_SCALE = 1;
/** Lines further than this from the active one stop dimming further. */
const MAX_DISTANCE = 6;

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Push scale onto the active line and bloom/blur onto the rest by distance. */
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
    // Depth: the further from the active line, the softer. Upstream already
    // consumes --BlurAmount in its text-shadow, so this rides that channel.
    const distance = Math.min(Math.abs(i - activeIndex), MAX_DISTANCE);
    el.style.setProperty("--BlurAmount", `${distance * 0.9}px`);
  });
}

/**
 * Start watching the lyrics page. Safe to call before lyrics exist — it waits
 * for the container, and re-attaches when ApplyLyrics replaces the content.
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

In `src/renderer/main.ts`, inside `start()`, after the `IntervalManager` block that drives `ScrollToActiveLine` (around line 126), add:

```ts
  const { startPunchLayer } = await import("./lyrics/punchLayer.ts");
  startPunchLayer();
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Verify by eye**

Run `npm run dev` and play the regenerated track. The active line should scale up slightly as it becomes active and settle; lines further away should soften progressively.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lyrics/punchLayer.ts src/renderer/main.ts
git commit -m "feat(renderer): per-line spring and depth blur for lyrics"
```

---

### Task 8: Split line-level lyrics into words

A line-level `<p>` becomes a single syllable (`ttmlXml.js:212`), so it receives none of the per-word machinery and renders as one smeared gradient. Splitting it gives the renderer words to animate.

Interpolated word times are a guess — evenly spaced inside the line. They read smooth but land off-syllable, and are strictly a fallback for tracks with no real alignment.

**Files:**
- Modify: `src/main/lyrics/ttmlXml.js:210-213`
- Test: `tests/lyrics/lineSplitting.test.ts` (create)

**Interfaces:**
- Consumes: `splitLineToSyllables(text, startTime, endTime)` — already exported from `src/main/lyrics/utils.js`.
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
    // Monotonic and non-overlapping.
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
Expected: FAIL — the first test gets one syllable containing the whole line.

- [ ] **Step 3: Write the implementation**

In `src/main/lyrics/ttmlXml.js`, add the import at the top beside the existing imports:

```js
import { splitLineToSyllables } from "./utils.js";
```

Then find (around line 210–213):

```js
      const plainText = cleanText(pContent);
```

and the `lines.push(...)` immediately below it that builds a single syllable. Replace that push with:

```js
      const plainText = cleanText(pContent);
      // A line-level <p> has no <span> children, so upstream's per-word
      // animation has nothing to attach to and the line renders as one smeared
      // gradient. Split it so every word gets an element. The timings are
      // interpolated — evenly spaced inside the line — and are a fallback for
      // tracks with no real alignment, not a substitute for one.
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

- [ ] **Step 5: Confirm nothing else regressed**

Run: `npx vitest run`
Expected: PASS — 93 tests. Pay attention to `tests/lyrics/toSpicyShape.test.ts`, which also exercises TTML parsing.

- [ ] **Step 6: Commit**

```bash
git add src/main/lyrics/ttmlXml.js tests/lyrics/lineSplitting.test.ts
git commit -m "feat(lyrics): split line-level TTML into per-word syllables"
```

---

### Task 9: Regenerate the remaining collapsed tracks

Only after Tasks 1–8 are verified. Eight tracks, one capture each at full track length — roughly 30 minutes of wall time, and they cannot be parallelised because each needs exclusive audio.

**Files:**
- Produces: 8 files in `~/.sweetly-custom/`

- [ ] **Step 1: List what still fails the guard**

```bash
node --input-type=module -e "
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const { parseTtmlXmlToJson } = await import('./src/main/lyrics/ttmlXml.js');
const { lyricsCoverTrack } = await import('./src/main/lyrics/utils.js');
const dir = path.join(os.homedir(),'.sweetly-custom');
for (const f of fs.readdirSync(dir).filter(f=>/\.ttml\$/i.test(f))) {
  let p=null; try { p=parseTtmlXmlToJson(fs.readFileSync(path.join(dir,f),'utf8')); } catch {}
  if (!p?.Content?.length) { console.log('EMPTY  ', f); continue; }
  if (!lyricsCoverTrack(p, 0)) console.log('COLLAPSED', f);
}
process.exit(0);
" 2>&1 | grep -vE "AppleMusicAPI|Sweetly-Main"
```

Expected: the 9 collapsed files identified earlier, minus Hard Knock (fixed in Task 5).

- [ ] **Step 2: Regenerate each**

For each listed file: move it aside to `/tmp`, play that track from 0:00 in the app, wait for the `[align]` completion log.

- [ ] **Step 3: Verify each with the Task 5 Step 4 script**

Substitute the filename and the real track duration. Every file must report `passes guard: true` and words/sec under 12.

- [ ] **Step 4: Commit nothing**

These live in `~/.sweetly-custom`, outside the repo.

---

## Self-Review

**Spec coverage:**
- A1 uncensored target → Tasks 1, 2. A1's "preserve masked as literal" → Task 4.
- A2 ad-lib rule → Task 3.
- A3 regenerate → Tasks 5, 9.
- B1 stylesheet → Task 6. B2 motion layer → Task 7. B3 synthesized words → Task 8.
- Out of scope (beat response) → correctly absent.
- Spec testing section: A1/A2/A3/B all covered. The spec says B is judged by eye, which Tasks 6 and 7 reflect.

**Deviation from spec, recorded:** the spec did not notice that `fetcher.js` triggers the aligner *before* fetching LRCLIB. Task 2 hoists that fetch. Without it, A1 could not work at all.

**Type consistency:** `pickAlignmentText` returns `{source, text} | null` and Task 2 reads `alignTarget?.text` and `alignTarget?.source` — consistent. `startPunchLayer()` returns a disposer, called with no arguments in Task 7 Step 2 — consistent. `splitLineToSyllables(text, startTime, endTime)` matches its existing signature in `utils.js:18`.

**Placeholder scan:** no TBD/TODO; every code step carries real code.
