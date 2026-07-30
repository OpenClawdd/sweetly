#!/usr/bin/env python3
"""Script-agnostic token normalisation in scripts/align_lyrics.py.

Run: python3 tests/test_align_norm.py
Dependency-free by design — no pytest, no torch.

norm() stripped everything outside ASCII [a-z0-9], so any token written in a
non-Latin script normalised to "". align_anchored line 322 drops a span whose
norm() is empty, so every Japanese line the aligner successfully placed was
thrown away again immediately: a 49-line track produced 14 lines, all of them
the ones that happened to contain Latin characters.

The failure is silent — no exception, no warning, and the truncated result
still spans the track at a plausible rate, so the coverage guard accepts it.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

from align_lyrics import norm  # noqa: E402


def test_latin_behaviour_is_unchanged():
    assert norm("Hello") == "hello"
    assert norm("don't") == "dont"
    assert norm("Track2") == "track2"
    assert norm("  spaced  ") == "spaced"


def test_punctuation_is_still_stripped():
    assert norm("...") == ""
    assert norm("!?") == ""
    assert norm("-") == ""


def test_japanese_survives_normalisation():
    # Hiragana, katakana and kanji all have to yield a non-empty key, or the
    # span is discarded by align_anchored.
    for token in ("こんにちは", "カタカナ", "世界"):
        assert norm(token) != "", f"{token!r} normalised to empty"


def test_other_scripts_survive():
    for token in ("привет", "ελλάδα", "한글"):
        assert norm(token) != "", f"{token!r} normalised to empty"


def test_normalisation_is_stable_for_comparison():
    # Both sides of every comparison run through norm(), so equal inputs must
    # produce equal keys regardless of case or surrounding punctuation.
    assert norm("世界") == norm("世界。")
    assert norm("Word!") == norm("word")


def test_masked_token_still_normalises_empty():
    # A censored word carries no comparable content; pickAlignmentText exists
    # precisely because these cannot be matched.
    assert norm("****") == ""


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok   {name}")
            except AssertionError as e:
                failures += 1
                print(f"FAIL {name}: {e}")
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
