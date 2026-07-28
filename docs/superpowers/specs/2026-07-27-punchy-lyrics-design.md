# Punchy lyrics

**Date:** 2026-07-27
**Status:** Approved, pending implementation plan

## Goal

Make the lyrics view hit. Today it reads soft: the active line never dominates,
state changes have no impact, the word fill smears instead of snapping, and the
type is timid against a saturated background.

The target is deliberately past Apple Music's own restraint — a visualizer
feel — while staying legible over the Kawarp background.

## Context

Four complaints, one investigation. Two of them turn out to be content bugs
rather than styling, and no amount of motion work compensates for lyrics whose
words are wrong.

### Why the view is flat

**Per-word motion is attached to `.word` elements.** `LyricsAnimator.ts:771-776`
drives spline-based `scale` and `translate3d` per word, and `:861` drives each
word's `--gradient-position`. Apple Music's line-level TTML produces no `.word`
children, so a line-level track receives none of that machinery — it gets a
single gradient sweeping across the whole line. This is the structural
difference between a word-level track and a line-level one, and it is the
larger part of what "not punchy" describes.

**Per-line scale is dead code.** `applyScale` at `LyricsAnimator.ts:610-638` is
commented out upstream, annotated *"kept for future reference"*. `--scale-amount`
is therefore never written, and `Mixed.css:769` (`scale: var(--scale-amount, 1)`)
always resolves to `1`. There is no line-level pop in any mode. Upstream's
version also set `0` for the active line, which would collapse it to nothing —
the scheme is not merely disabled, it is wrong, and must not be resurrected
as-is.

**Contrast is tuned soft.** `Mixed.css:44-45` sets `--gradient-alpha: 0.85` and
`--gradient-alpha-end: 0.5`. Sung and unsung text differ by 35 percentage points
of alpha over a fully saturated animated background, with no scrim between them.
`SimpleLyricsMode` already uses `1` / `0.3` — evidence that the softer default is
a choice, not a constraint.

### Why the content is wrong

**Apple censors at the source.** Apple Music returns `Sweeping these **** right
up, no Dex` for this track even when the *explicit* release is matched
(`id=1882124565`, scored explicit). `fetcher.js:94` feeds that text to the
aligner as its alignment target. `norm()` in `align_lyrics.py:34` strips
non-alphanumerics, reducing `****` to the empty string, so the word is **dropped
rather than masked** — the stored TTML reads `Sweeping these right up, no Dex`.

LRCLIB carries the uncensored text for the same track.

**The ad-lib regex mangles lines.** `autoAligner.js:87` lists `pop`, `yeah`,
`oh`, `ha`, `gang` and others as interjections, and `:119` tests every *token*
against it. Any standalone occurrence is moved into an `x-bg` background span,
so `I'm 'bout to pop me a bean on this track` is stored as `I'm 'bout to me a
bean on this track` with `pop` relocated to background vocals. The regex was
built to catch genuine ad-libs and instead eats ordinary lyrics.

These two bugs are why regenerating alignments without fixing them first would
produce correctly-timed but still-wrong text.

## Design

Two parts, sequenced. Part A is a prerequisite: tuning motion against mangled or
synthesized words calibrates the timing feel to the wrong thing.

### Part A — Content correctness

**A1. Choose the alignment target by quality.**
Select the plain-text target from the available sources rather than always using
Apple's. Prefer an uncensored source; fall back to Apple when nothing better
exists. Censoring is detected by scanning candidate text for runs of two or more
`*`. This lives in `fetcher.js`, where all sources are already in hand.

When every available source is censored, the masked token must be **preserved as
a literal** (`****`) rather than dropped. `norm()` currently reduces it to empty
and the converter discards it, which is what puts a hole in the line. A masked
word keeps the line's shape and word count; a missing one does not.

**A2. Narrow the ad-lib rule.**
In `autoAligner.js`, treat a token as background only when it is parenthesised,
or when it constitutes the entire line. Mid-line occurrences stay in the lead.

*Deliberate behaviour change:* a genuine ad-lib thrown mid-bar will now render in
the lead rather than stacked underneath. Dropping real lyrics is the worse
failure, so this is the correct default.

**A3. Regenerate.**
Hard Knock first, as proof the fixed aligner and the fixed text path produce a
good file. The remaining 8 collapsed tracks follow only once that is confirmed.

### Part B — Punch

**B1. `renderer/styles/punch.css`** — loaded after upstream, overriding by
custom property rather than by selector where possible:

- sung alpha `0.85 → 1.0`, unsung `0.5 → 0.22`
- larger `--DefaultLyricsSize`
- a scrim behind the lyrics column so text stops competing with Kawarp
- bloom `text-shadow` on `.line.Active`
- steeper `--BlurAmount` falloff with distance from the active line

The alpha figures above are starting points carried from `SimpleLyricsMode`,
which already ships `1` / `0.3`. Every other value here — type scale, scrim
opacity, bloom radius, blur falloff — is to be settled by eye against a real
word-level track during B, not fixed in this document. The plan should treat
them as tunables, not acceptance criteria.

**B2. `renderer/lyrics/punchLayer.ts`** — the per-line spring that does not exist
today. Observes line state transitions, drives `scale` and Y offset through
WAAPI with spring physics, tints the bloom from the artwork accent, and scales
blur by distance. It writes its own custom property; it does not revive
upstream's broken `--scale-amount` contract.

**B3. Synthesized `.word` spans for line-level lyrics** — so a track without word
data still receives per-word treatment instead of a flat gradient smear.

*Known limitation:* synthesized words are spaced evenly within their line, which
is a guess. They will read smooth but land off-syllable. Tracks with real
forced alignments will always hit harder; the remedy is regenerating more
tracks, not more motion work.

Both B files are host-side. **No upstream files are edited.**

## Out of scope

**Beat-responsive motion.** It requires an always-on audio tap; BlackHole capture
currently runs only during alignment. A separate project, not a half-build.

## Testing

- A1: unit tests for censored-text detection and target selection across source
  combinations, including the all-censored case.
- A2: unit tests over the converter asserting that `pop me a bean` keeps `pop` in
  the lead, while a parenthesised `(yeah)` and a whole-line `Yeah` still become
  background.
- A3: regenerated file must pass `lyricsCoverTrack` against the real track
  duration, and its text must contain the previously-dropped word.
- B: verified in the running app against a real word-level track. The motion
  work is judged by eye; there is no meaningful assertion for "punchy".

## Risks

- **B3 sets an expectation it cannot fully meet.** If synthesized words feel
  wrong, the honest answer is more regeneration, not more tuning.
- **A1 depends on LRCLIB having the track.** When no uncensored source exists,
  the censored word should be preserved as-is rather than dropped, so the line
  keeps its shape.
- **Regeneration costs a full playback per track** (~3 min each). The 8
  follow-on tracks are ~30 minutes of wall time.
