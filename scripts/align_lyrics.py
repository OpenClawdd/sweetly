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


def norm(token: str) -> str:
    return re.sub(r"[^a-z0-9]", "", token.lower())


def lyric_lines(text: str):
    """Split raw lyrics into lines of tokens, dropping [Verse]/(Chorus) markers."""
    lines = []
    for raw in text.splitlines():
        raw = raw.strip()
        if not raw or re.fullmatch(r"[\[(].*[\])]", raw):
            continue
        tokens = [t for t in raw.split() if WORD_RE.search(t)]
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

    spans = []
    cursor = 0.0
    token_i = 0
    stalls = 0

    while token_i < len(tokens) and cursor < audio_end - 0.2:
        win_end = min(cursor + WINDOW_SECONDS, audio_end)
        final_window = win_end >= audio_end - 0.05

        # Give this window a proportional share of what's left, plus slack —
        # over-supplying is safe because unconsumed tokens roll forward.
        remaining_time = max(0.1, audio_end - cursor)
        share = (win_end - cursor) / remaining_time
        est = int(len(tokens[token_i:]) * share * 1.6) + 8
        chunk = tokens[token_i:token_i + est]
        if not chunk:
            break

        clip = audio[int(cursor * SAMPLE_RATE):int(win_end * SAMPLE_RATE)]
        try:
            results = model.align(audio=(clip, SAMPLE_RATE), text=" ".join(chunk), language=language)
            items = list(results[0])
        except Exception as e:
            print(f"[align] window {cursor:.0f}-{win_end:.0f}s failed: {e}", file=sys.stderr)
            items = []

        cutoff = (win_end - cursor) if final_window else (win_end - cursor - TAIL_MARGIN)
        accepted = []
        for it in items:
            text = getattr(it, "text", "") or ""
            if not norm(text):
                continue
            start = float(getattr(it, "start_time", 0.0) or 0.0)
            end = float(getattr(it, "end_time", 0.0) or 0.0)
            if not final_window and start >= cutoff:
                break
            accepted.append({"word": text, "start": cursor + start, "end": cursor + end})

        if not accepted:
            # Nothing usable here — step forward rather than spin.
            stalls += 1
            cursor = win_end if stalls > 1 else cursor + WINDOW_SECONDS / 2
            if stalls > 3:
                print("[align] too many empty windows, stopping", file=sys.stderr)
                break
            continue

        stalls = 0
        spans.extend(accepted)
        token_i += len(accepted)
        # Resume where the accepted audio ended so nothing is skipped.
        cursor = max(accepted[-1]["end"], cursor + 0.5)

    print(
        f"[align] forced: {len(spans)} aligned spans covering "
        f"{spans[-1]['end']:.0f}s of {audio_end:.0f}s" if spans else "[align] forced: no spans",
        file=sys.stderr,
    )
    if not spans:
        return None

    return sanitize(regroup_spans_into_lines(spans, lines), audio_end)


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

    segments = None
    if args.lyrics:
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
