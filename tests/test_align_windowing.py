#!/usr/bin/env python3
"""Windowing contract for scripts/align_lyrics.py.

Run: python3 tests/test_align_windowing.py

Deliberately dependency-free (no pytest, no torch): it exercises walk_windows
with fake aligners so the token-cursor invariant can be checked without loading
a 0.6B model.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

from align_lyrics import MAX_WORDS_PER_SEC, WINDOW_SECONDS, walk_windows  # noqa: E402

TRACK = 161.99          # "Hard Knock" — slayr
N_TOKENS = 537          # words the aligner was handed
TOKENS = [f"w{i}" for i in range(N_TOKENS)]


def collapsing_aligner(cursor, win_end, chunk):
    """The observed failure: every token handed in comes back stamped into a
    sliver at the head of the window, regardless of how much audio there is."""
    return [(w, 0.001 * i, 0.001 * i + 0.05) for i, w in enumerate(chunk)]


def healthy_aligner(cursor, win_end, chunk):
    """A well-behaved aligner spreads its tokens across the window it was given."""
    span = win_end - cursor
    step = span / max(1, len(chunk))
    return [(w, i * step, (i + 1) * step) for i, w in enumerate(chunk)]


def sparse_aligner(cursor, win_end, chunk):
    """A window with only a few words actually sung, early, then instrumental.
    Legitimate — must not be mistaken for a collapse."""
    return [(w, 0.4 * i, 0.4 * i + 0.35) for i, w in enumerate(chunk[:6])]


def rate(spans):
    if len(spans) < 2:
        return 0.0
    span = spans[-1]["end"] - spans[0]["start"]
    return len(spans) / span if span > 0 else float("inf")


def test_collapse_is_not_accepted():
    spans = walk_windows(TOKENS, TRACK, collapsing_aligner)
    # The bug: all 537 tokens consumed while the cursor sat at ~4s, producing a
    # TTML whose body dur was 00:00:03.730 for a 162s track.
    assert rate(spans) <= MAX_WORDS_PER_SEC, (
        f"accepted a collapsed alignment: {len(spans)} words in "
        f"{(spans[-1]['end'] - spans[0]['start']) if spans else 0:.2f}s"
    )
    assert len(spans) < N_TOKENS, "consumed the whole lyric into a collapsed window"


def test_healthy_alignment_covers_the_track():
    spans = walk_windows(TOKENS, TRACK, healthy_aligner)
    assert spans, "healthy aligner produced nothing"
    assert rate(spans) <= MAX_WORDS_PER_SEC, f"implausible rate {rate(spans):.1f} w/s"
    covered = spans[-1]["end"]
    assert covered > TRACK * 0.8, f"only covered {covered:.1f}s of {TRACK}s"
    assert spans == sorted(spans, key=lambda s: s["start"]), "spans not monotonic"


def test_sparse_window_is_not_treated_as_collapse():
    spans = walk_windows(TOKENS, TRACK, sparse_aligner)
    assert spans, "sparse-but-legitimate windows were rejected as collapsed"
    # Six words every ~2.4s of audio: slow, but real.
    assert rate(spans) <= MAX_WORDS_PER_SEC


def test_cursor_never_outruns_audio():
    """The invariant the bug violated: tokens may only be consumed in step with
    audio actually covered."""
    for aligner in (collapsing_aligner, healthy_aligner, sparse_aligner):
        spans = walk_windows(TOKENS, TRACK, aligner)
        if not spans:
            continue
        assert spans[-1]["end"] <= TRACK + WINDOW_SECONDS, (
            f"{aligner.__name__}: spans ran past the end of the audio"
        )
        assert rate(spans) <= MAX_WORDS_PER_SEC, f"{aligner.__name__}: {rate(spans):.1f} w/s"


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
