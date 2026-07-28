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
