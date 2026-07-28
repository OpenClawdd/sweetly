#!/usr/bin/env python3
"""
Produce word-level timings for a track, and write them as Sweetly-shaped JSON.

Two paths, picked automatically:

  forced   — we already know the words (e.g. Apple shipped the song with
             itunes:timing="None": correct lyrics, no clock). Qwen3-ForcedAligner
             takes the known text plus the audio and returns per-word spans.
             No transcription, so nothing can be misheard.

  asr      — no lyrics anywhere. Fall back to WhisperX transcription, which
             has to guess the words as well as the timings.

Prefer `forced` whenever any lyrics text exists; it is both faster and strictly
more accurate, since the hard half of the problem is already solved.

Device note: WhisperX's ASR backend is CTranslate2, which on Apple Silicon is
CPU-only (no Metal, no CUDA) — `--device mps --compute_type float16` is not a
valid configuration for it and will fail. The Qwen aligner is a torch model and
does run on MPS, which is why the forced path is the one that uses the GPU.

Output matches what autoAligner.js consumes:
  {"segments": [{"start": f, "end": f, "words": [{"word": s, "start": f, "end": f}]}]}
"""
import argparse
import json
import re
import sys

WORD_RE = re.compile(r"[^\W_]+(?:'[^\W_]+)*", re.UNICODE)

# A fully-masked word from a censored source. It carries no sound to align, but
# it must keep its slot so the line does not silently lose a word.
MASK_RE = re.compile(r"^\*{2,}$")


def norm(token: str) -> str:
    return re.sub(r"[^a-z0-9]", "", token.lower())


def lyric_lines(text: str):
    """Split raw lyrics into lines of tokens, dropping [Verse]/(Chorus) markers."""
    lines = []
    for raw in text.splitlines():
        raw = raw.strip()
        if not raw or re.fullmatch(r"[\[(].*[\])]", raw):
            continue
        tokens = [t for t in raw.split() if WORD_RE.search(t) or MASK_RE.match(t)]
        if tokens:
            lines.append(tokens)
    return lines


def regroup_spans_into_lines(spans, lines):
    """
    Map the aligner's flat token stream back onto the original lyric lines.

    Spans arrive in the order we supplied the tokens, so this walks both
    sequences together. Tokens are matched on their normalized form to stay
    robust to the aligner splitting or re-casing a word; anything that fails to
    match still advances so the two streams cannot drift apart.
    """
    segments = []
    si = 0
    for tokens in lines:
        words = []
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
        if words:
            segments.append({"start": words[0]["start"], "end": words[-1]["end"], "words": words})
    return segments


def spread_degenerate_runs(segments, audio_end, min_run=6, eps=0.12):
    """
    Redistribute pile-ups.

    When the supplied lyrics run past what the audio actually contains — a
    capture cut short by Automix, a fade-out, a long instrumental tail — the
    aligner has nowhere to put the leftover tokens and stacks them all on one
    timestamp. A run of words sharing a start is never real singing, so spread
    any such run evenly across the time available to it. The result is honest
    approximation instead of a wall of words firing at once.
    """
    words = [w for seg in segments for w in seg["words"]]
    n = len(words)
    if n == 0:
        return segments

    i = 0
    while i < n:
        j = i + 1
        while j < n and abs(words[j]["start"] - words[i]["start"]) <= eps:
            j += 1
        run = j - i
        if run >= min_run:
            lo = words[i]["start"]
            hi = words[j]["start"] if j < n else max(audio_end, lo + run * 0.35)
            if hi <= lo:
                hi = lo + run * 0.35
            step = (hi - lo) / run
            print(f"[align] spreading {run} stacked words at {lo:.1f}s over {hi - lo:.1f}s", file=sys.stderr)
            for k in range(run):
                words[i + k]["start"] = lo + k * step
                words[i + k]["end"] = lo + (k + 1) * step
        i = j

    return segments


def sanitize(segments, audio_end=None):
    """Force monotonic, non-degenerate timings so the renderer never divides by zero."""
    if audio_end:
        spread_degenerate_runs(segments, audio_end)

    prev = 0.0
    for seg in segments:
        for w in seg["words"]:
            w["start"] = max(prev, float(w["start"]))
            w["end"] = max(w["start"] + 0.05, float(w["end"]))
            prev = w["start"]
        seg["start"] = seg["words"][0]["start"]
        seg["end"] = seg["words"][-1]["end"]
    return segments


# The aligner's audio encoder tops out at max_source_positions=1500 frames
# (~30s). Handing it a whole song silently collapses everything past its
# context into a pile at the end, so walk the track in windows instead.
WINDOW_SECONDS = 26.0
# Tokens landing near a window's edge are probably clipped, so hold them back
# and let the next window (which starts where they began) redo them.
TAIL_MARGIN = 2.5
SAMPLE_RATE = 16000

# Nobody delivers words faster than this. A window that claims to has collapsed:
# handed more text than its clip contains, the encoder stamps every token into a
# sliver at the head of the window instead of refusing the surplus.
MAX_WORDS_PER_SEC = 12.0
# Too few words to judge a rate from — a legitimately sparse window looks fast.
MIN_COLLAPSE_SAMPLE = 5
# Over-supply is what makes the encoder cram, so a collapsed window is retried
# with progressively less text before its audio is written off.
SUPPLY_START = 1.6
SUPPLY_BACKOFF = 0.5
SUPPLY_FLOOR = 0.5


def _accepted_span(accepted):
    return accepted[-1]["end"] - accepted[0]["start"]


def collapsed(accepted):
    """True when a window's words claim a humanly impossible delivery rate."""
    if len(accepted) < MIN_COLLAPSE_SAMPLE:
        return False
    span = _accepted_span(accepted)
    if span <= 0:
        return True
    return len(accepted) / span > MAX_WORDS_PER_SEC


def walk_windows(tokens, audio_end, align_window):
    """Walk the track in windows, consuming lyric tokens only as audio is covered.

    `align_window(cursor, win_end, chunk)` returns an iterable of
    `(text, start, end)` with times relative to the window start.

    The invariant this enforces: **the token pointer may never outrun the audio
    cursor.** Consuming tokens at the per-window estimate while the cursor
    advanced by a 0.5s floor is what stamped whole songs into their first few
    seconds — 537 words inside 3.7s of a 162s track. A window whose output is
    physically impossible is retried with less text, then skipped; its tokens
    are never spent.

    Kept free of torch/whisperx so the contract stays testable.
    """
    spans = []
    cursor = 0.0
    token_i = 0
    stalls = 0
    supply = SUPPLY_START

    while token_i < len(tokens) and cursor < audio_end - 0.2:
        win_end = min(cursor + WINDOW_SECONDS, audio_end)
        final_window = win_end >= audio_end - 0.05

        # Give this window a proportional share of what's left, plus slack.
        remaining_time = max(0.1, audio_end - cursor)
        share = (win_end - cursor) / remaining_time
        est = int(len(tokens[token_i:]) * share * supply) + 8
        chunk = tokens[token_i:token_i + est]
        if not chunk:
            break

        cutoff = (win_end - cursor) if final_window else (win_end - cursor - TAIL_MARGIN)
        accepted = []
        for text, start, end in align_window(cursor, win_end, chunk):
            if not norm(text):
                continue
            if not final_window and start >= cutoff:
                break
            accepted.append({"word": text, "start": cursor + start, "end": cursor + end})

        if not accepted:
            # Nothing usable here — step forward rather than spin.
            stalls += 1
            supply = SUPPLY_START
            cursor = win_end if stalls > 1 else cursor + WINDOW_SECONDS / 2
            if stalls > 3:
                print("[align] too many empty windows, stopping", file=sys.stderr)
                break
            continue

        if not final_window and collapsed(accepted):
            if supply > SUPPLY_FLOOR:
                supply *= SUPPLY_BACKOFF
                print(
                    f"[align] window {cursor:.0f}-{win_end:.0f}s collapsed "
                    f"({len(accepted)} words in {_accepted_span(accepted):.2f}s), "
                    f"retrying at {supply:.2f}x tokens",
                    file=sys.stderr,
                )
                continue  # same cursor, same tokens, less text
            # Even a minimal supply collapses. Give up on this audio rather than
            # spend the rest of the lyric inside it.
            stalls += 1
            supply = SUPPLY_START
            print(
                f"[align] window {cursor:.0f}-{win_end:.0f}s still collapsing, skipping",
                file=sys.stderr,
            )
            cursor = max(win_end - TAIL_MARGIN, cursor + WINDOW_SECONDS / 2)
            if stalls > 3:
                print("[align] too many collapsed windows, stopping", file=sys.stderr)
                break
            continue

        stalls = 0
        supply = SUPPLY_START
        spans.extend(accepted)
        token_i += len(accepted)
        # Resume where the accepted audio ended so nothing is skipped.
        cursor = max(accepted[-1]["end"], cursor + 0.5)

    return spans


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
            start = float(anchor["start"])
            end = float(anchor["end"])
            limit = float(audio_end)
        except (KeyError, TypeError, ValueError):
            continue
        # Judge the window before padding: padding alone would make even a
        # zero-width anchor look alignable.
        if end - start < MIN_ANCHOR_WINDOW:
            continue

        lo = max(0.0, start - ANCHOR_PAD)
        hi = min(limit, end + ANCHOR_PAD)
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


def run_forced(audio_path, lyrics_text, language, device, dtype_name):
    import numpy as np
    import torch
    import whisperx
    from qwen_asr import Qwen3ForcedAligner

    lines = lyric_lines(lyrics_text)
    if not lines:
        return None

    tokens = [t for toks in lines for t in toks]
    dtype = {"float32": torch.float32, "float16": torch.float16, "bfloat16": torch.bfloat16}[dtype_name]

    audio = whisperx.load_audio(audio_path)
    audio_end = len(audio) / SAMPLE_RATE

    print(
        f"[align] forced: device={device} dtype={dtype_name} tokens={len(tokens)} "
        f"audio={audio_end:.0f}s window={WINDOW_SECONDS:.0f}s",
        file=sys.stderr,
    )
    model = Qwen3ForcedAligner.from_pretrained(
        "Qwen/Qwen3-ForcedAligner-0.6B", dtype=dtype, device_map=device
    )

    def align_window(cursor, win_end, chunk):
        clip = audio[int(cursor * SAMPLE_RATE):int(win_end * SAMPLE_RATE)]
        try:
            results = model.align(audio=(clip, SAMPLE_RATE), text=" ".join(chunk), language=language)
            items = list(results[0])
        except Exception as e:
            print(f"[align] window {cursor:.0f}-{win_end:.0f}s failed: {e}", file=sys.stderr)
            return []
        return [
            (
                getattr(it, "text", "") or "",
                float(getattr(it, "start_time", 0.0) or 0.0),
                float(getattr(it, "end_time", 0.0) or 0.0),
            )
            for it in items
        ]

    spans = walk_windows(tokens, audio_end, align_window)

    print(
        f"[align] forced: {len(spans)} aligned spans covering "
        f"{spans[-1]['end']:.0f}s of {audio_end:.0f}s" if spans else "[align] forced: no spans",
        file=sys.stderr,
    )
    if not spans:
        return None

    return sanitize(regroup_spans_into_lines(spans, lines), audio_end)


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


MIN_WORD_DUR = 0.09


def prune_impossible_anchors(words, min_dur=MIN_WORD_DUR):
    """
    Drop anchors that imply physically impossible word rates.

    A short repeated phrase can match the wrong occurrence, leaving two anchors
    0.2s apart with thirty words between them. Interpolation then has nowhere
    to put those words and crushes them onto one instant. Whenever a gap cannot
    hold its words at a plausible rate, the later anchor is the suspect one, so
    drop it and let the span stretch to the next trustworthy anchor.
    """
    known = [i for i, w in enumerate(words) if w["start"] is not None]
    dropped = 0
    k = 0
    while k + 1 < len(known):
        a, b = known[k], known[k + 1]
        needed = (b - a) * min_dur
        available = words[b]["start"] - words[a]["start"]
        if available < needed:
            words[b]["start"] = words[b]["end"] = None
            known.pop(k + 1)
            dropped += 1
            continue
        k += 1

    if dropped:
        print(f"[align] dropped {dropped} implausible anchors", file=sys.stderr)
    return words


def interpolate(words, audio_end):
    """Fill start/end on words no ASR token matched, spreading them evenly."""
    n = len(words)
    known = [i for i, w in enumerate(words) if w["start"] is not None]
    if not known:
        step = audio_end / max(1, n)
        for i, w in enumerate(words):
            w["start"], w["end"] = i * step, (i + 1) * step
        return words

    first = known[0]
    if first > 0:
        step = words[first]["start"] / (first + 1)
        for i in range(first):
            words[i]["start"], words[i]["end"] = i * step, (i + 1) * step

    for a, b in zip(known, known[1:]):
        if b - a <= 1:
            continue
        lo, hi = words[a]["end"], words[b]["start"]
        if hi <= lo:
            hi = lo + 0.001 * (b - a)
        step = (hi - lo) / (b - a)
        for k in range(a + 1, b):
            off = k - a
            words[k]["start"] = lo + (off - 1) * step
            words[k]["end"] = lo + off * step

    last = known[-1]
    if last < n - 1:
        lo = words[last]["end"]
        hi = max(audio_end, lo + 0.4 * (n - last))
        step = (hi - lo) / (n - last)
        for k in range(last + 1, n):
            off = k - last
            words[k]["start"] = lo + (off - 1) * step
            words[k]["end"] = lo + off * step

    return words


def run_asr_reconciled(audio_path, lyrics_text, language, asr_compute_type, asr_model):
    """
    Timings from ASR, words from the real lyrics.

    Forced alignment cannot decline text — it distributes whatever it is given
    across whatever audio it is given, so feeding a full song in guessed
    windows piles surplus tokens onto single timestamps. ASR instead reports
    only what it actually heard and when, which yields a trustworthy clock.
    We then map those timings onto the known-correct lyrics, so mis-heard words
    never reach the screen and only the timing is borrowed.
    """
    from difflib import SequenceMatcher
    import whisperx

    lines = lyric_lines(lyrics_text)
    if not lines:
        return None

    audio = whisperx.load_audio(audio_path)
    audio_end = len(audio) / SAMPLE_RATE

    print(f"[align] asr-reconciled: cpu/{asr_compute_type} model={asr_model} audio={audio_end:.0f}s", file=sys.stderr)
    model = whisperx.load_model(asr_model, "cpu", compute_type=asr_compute_type, language=language)
    result = model.transcribe(audio, batch_size=8)

    import torch
    align_device = "mps" if torch.backends.mps.is_available() else "cpu"
    model_a, metadata = whisperx.load_align_model(language_code=language, device=align_device)
    aligned = whisperx.align(result["segments"], model_a, metadata, audio, align_device,
                             return_char_alignments=False)

    asr_words = [
        w for seg in aligned.get("segments", []) for w in seg.get("words", [])
        if w.get("start") is not None
    ]
    print(f"[align] asr heard {len(asr_words)} timed words", file=sys.stderr)

    flat = [(li, t) for li, toks in enumerate(lines) for t in toks]
    placed = [{"word": t, "line": li, "start": None, "end": None} for li, t in flat]

    asr_keys = [norm(w.get("word", "")) for w in asr_words]
    lyric_keys = [norm(t) for _, t in flat]

    for tag, i1, i2, j1, j2 in SequenceMatcher(None, asr_keys, lyric_keys, autojunk=False).get_opcodes():
        if tag != "equal":
            continue
        for off in range(i2 - i1):
            a, p = asr_words[i1 + off], placed[j1 + off]
            p["start"], p["end"] = float(a["start"]), float(a.get("end") or a["start"] + 0.1)

    matched = sum(1 for p in placed if p["start"] is not None)
    print(f"[align] matched {matched}/{len(placed)} lyric words ({matched / max(1, len(placed)):.0%})", file=sys.stderr)

    prune_impossible_anchors(placed)
    interpolate(placed, audio_end)

    segments = []
    for li in range(len(lines)):
        ws = [p for p in placed if p["line"] == li]
        if ws:
            segments.append({
                "start": ws[0]["start"], "end": ws[-1]["end"],
                "words": [{"word": w["word"], "start": w["start"], "end": w["end"]} for w in ws],
            })
    return sanitize(segments, audio_end)


def run_asr(audio_path, language, compute_type, model_name):
    import whisperx

    # CTranslate2 has no Metal backend; this path is CPU regardless of hardware.
    print(f"[align] asr: cpu/{compute_type} model={model_name}", file=sys.stderr)
    audio = whisperx.load_audio(audio_path)
    model = whisperx.load_model(model_name, "cpu", compute_type=compute_type, language=language)
    result = model.transcribe(audio, batch_size=8)

    import torch
    align_device = "mps" if torch.backends.mps.is_available() else "cpu"
    model_a, metadata = whisperx.load_align_model(language_code=language, device=align_device)
    aligned = whisperx.align(result["segments"], model_a, metadata, audio, align_device,
                             return_char_alignments=False)

    segments = []
    for seg in aligned.get("segments", []):
        words = [
            {"word": w.get("word", ""), "start": float(w.get("start") or 0.0), "end": float(w.get("end") or 0.0)}
            for w in seg.get("words", [])
            if w.get("start") is not None and w.get("end") is not None
        ]
        if words:
            segments.append({"start": words[0]["start"], "end": words[-1]["end"], "words": words})
    print(f"[align] asr: {len(segments)} segments", file=sys.stderr)
    return sanitize(segments)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--lyrics", help="UTF-8 text file of known, untimed lyrics")
    ap.add_argument("--anchors", help="JSON file of [{text,start,end}] line windows")
    ap.add_argument("--language", default="English")
    ap.add_argument("--device", default="mps")
    ap.add_argument("--dtype", default="float32", choices=["float32", "float16", "bfloat16"])
    ap.add_argument("--asr-model", default="small")
    ap.add_argument("--asr-compute-type", default="int8")
    ap.add_argument(
        "--mode", default="reconciled", choices=["reconciled", "forced"],
        help="reconciled: ASR timings mapped onto known lyrics (best for full songs). "
             "forced: Qwen forced alignment (accurate only when text and audio already correspond).",
    )
    args = ap.parse_args()

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
        try:
            segments = run_anchored(args.audio, anchors, args.language, args.device, args.dtype)
        except Exception as e:
            print(f"[align] anchored alignment failed ({e}); falling back", file=sys.stderr)
            segments = None
        if not segments:
            print("[align] anchored pass produced nothing, falling back", file=sys.stderr)

    if segments:
        pass
    elif args.lyrics:
        try:
            with open(args.lyrics, "r", encoding="utf-8") as fh:
                lyrics_text = fh.read()
            lang = "en" if args.language.lower().startswith("en") else args.language
            if args.mode == "forced":
                segments = run_forced(args.audio, lyrics_text, args.language, args.device, args.dtype)
            else:
                segments = run_asr_reconciled(
                    args.audio, lyrics_text, lang, args.asr_compute_type, args.asr_model
                )
        except Exception as e:
            print(f"[align] lyric alignment failed ({e}); falling back to plain ASR", file=sys.stderr)
            segments = None

    if not segments:
        lang = "en" if args.language.lower().startswith("en") else args.language
        segments = run_asr(args.audio, lang, args.asr_compute_type, args.asr_model)

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"segments": segments}, fh, ensure_ascii=False)
    print(f"[align] wrote {len(segments)} segments -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
