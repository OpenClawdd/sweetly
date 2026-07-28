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
