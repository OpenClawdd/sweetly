export const SPICY_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export const SEARCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export function parseTTMLTime(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  const clean = String(ts)
    .replace(/s$/i, "")
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
  if (!clean) return 0;
  const parts = clean.split(":");
  if (parts.length === 3)
    return (
      parseFloat(parts[0] || 0) * 3600 + parseFloat(parts[1] || 0) * 60 + parseFloat(parts[2] || 0)
    );
  if (parts.length === 2) return parseFloat(parts[0] || 0) * 60 + parseFloat(parts[1] || 0);
  return parseFloat(clean) || 0;
}

/**
 * Fraction of a track that synced lyrics must reach before we trust them.
 * Generous on purpose: a long instrumental outro is normal, so only a
 * catastrophic collapse should trip this.
 */
const MIN_TRACK_COVERAGE = 0.5;

/**
 * Nobody delivers words faster than this. Mirrors MAX_WORDS_PER_SEC in
 * scripts/align_lyrics.py — the same collapse, caught on the way back out.
 */
const MAX_WORDS_PER_SEC = 12;
/** Too few syllables to infer a rate from. */
const MIN_RATE_SAMPLE = 8;

/** First start, last end and syllable count across a parsed lyrics payload. */
function timingStats(data) {
  let first = Infinity;
  let last = 0;
  let syllables = 0;
  for (const line of data?.Content ?? []) {
    for (const group of [line?.Lead, line?.Background]) {
      if (!group) continue;
      if (Number.isFinite(group.StartTime)) first = Math.min(first, group.StartTime);
      if (Number.isFinite(group.EndTime)) last = Math.max(last, group.EndTime);
      for (const syl of group.Syllables ?? []) {
        syllables += 1;
        if (Number.isFinite(syl?.StartTime)) first = Math.min(first, syl.StartTime);
        if (Number.isFinite(syl?.EndTime)) last = Math.max(last, syl.EndTime);
      }
    }
  }
  return { first: Number.isFinite(first) ? first : 0, last, syllables };
}

/** Below this, a word cannot be read before it is gone. */
const CRAMMED_WORD = 0.06;

/** Above this, a single "word" is really holding a whole line. */
const STUCK_WORD = 1.5;

/** Share of bad words past which the file is not worth showing. */
const MAX_BAD_WORD_SHARE = 0.25;

/** Fewer words than this and the sample says nothing. */
const MIN_WORD_SAMPLE = 8;

/** Mean syllables per line above which a payload is really word-timed. */
const WORD_LEVEL_RATIO = 1.3;

/**
 * Are these word timings good enough to be worth showing?
 *
 * `lyricsCoverTrack` asks whether the timings reach across the track. That
 * misses the failure that actually matters: all 35 files in ~/.sweetly-custom
 * passed it at 100% coverage while 32 were unusable, because the damage sits
 * inside the span rather than at its ends.
 *
 * Both signatures come from `scripts/align_lyrics.py`. A word the aligner could
 * not place leaves `sanitize()` at exactly the 0.05s floor and flashes past
 * unreadably; line timings copied onto word spans leave every word holding a
 * whole line, so nothing highlights until the line is already over.
 * `spread_degenerate_runs` repairs only pile-ups of six or more words sharing a
 * timestamp, so everything else reaches disk looking structurally perfect.
 *
 * The two checks have deliberately different scope. Nothing is readable in
 * 60ms, so the crammed check applies to any granularity — a line-synced file
 * whose every line lasts 0.05s is as broken as a word-timed one. A span of
 * several seconds, on the other hand, is only wrong if it claims to be a word:
 * it is exactly what a line looks like, so the stuck check is limited to
 * payloads carrying more than one span per line. Judging line-synced lyrics by
 * word rules would reject every LRCLIB result.
 */
export function wordTimingsUsable(data) {
  if (!data?.Content?.length) return true;
  if (data.Unsynced || data.Type === "Static") return true;

  const durations = [];
  let lines = 0;
  for (const line of data.Content) {
    lines += 1;
    for (const group of [line?.Lead, line?.Background]) {
      for (const syl of group?.Syllables ?? []) {
        const start = syl?.StartTime;
        const end = syl?.EndTime;
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          durations.push(end - start);
        }
      }
    }
  }

  if (durations.length < MIN_WORD_SAMPLE) return true;

  const wordLevel = durations.length / lines >= WORD_LEVEL_RATIO;
  const bad = durations.filter((d) => d <= CRAMMED_WORD || (wordLevel && d >= STUCK_WORD)).length;
  return bad / durations.length <= MAX_BAD_WORD_SHARE;
}

/**
 * Do these synced lyrics actually span the track?
 *
 * The forced aligner can return every line stamped into the first few seconds
 * (see `scripts/align_lyrics.py` — the token cursor outrunning the audio
 * cursor). Such a file parses fine and renders fine; it just flashes the whole
 * song past in four seconds and then sits dead. Callers use this to fall
 * through to the next lyrics source instead of serving the collapse.
 *
 * Two independent checks, because the duration is not always there to check
 * against: `appleMusic.js` reports `duration: … || 0` whenever Music.app is
 * stopped, which would let a coverage-only guard silently no-op. A delivery
 * rate no human could produce gives the collapse away on its own.
 *
 * Unsynced text is always accepted — there are no timings to judge, and
 * rejecting it would lose lyrics we can still display.
 */
export function lyricsCoverTrack(data, trackDuration) {
  if (!data?.Content?.length) return true;
  if (data.Unsynced || data.Type === "Static") return true;

  const { first, last, syllables } = timingStats(data);

  // 1. Intrinsic: is this a physically possible delivery rate?
  if (syllables >= MIN_RATE_SAMPLE) {
    const span = last - first;
    if (span <= 0) return false;
    if (syllables / span > MAX_WORDS_PER_SEC) return false;
  }

  // 2. Relative: do the timings actually reach across the track?
  if (!Number.isFinite(trackDuration) || trackDuration <= 0) return true;
  return last >= trackDuration * MIN_TRACK_COVERAGE;
}

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

    const text = lead.Syllables.map((s) => s?.Text ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;

    const start = Number(lead.StartTime);
    const end = Number(lead.EndTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    anchors.push({ text, start, end });
  }
  return anchors;
}

export function splitLineToSyllables(text, startTime, endTime) {
  if (!text) return [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const duration = endTime > startTime ? endTime - startTime : 0;
  return words.map((w, i) => ({
    Text: w,
    StartTime: duration > 0 ? startTime + (i / words.length) * duration : startTime,
    EndTime: duration > 0 ? startTime + ((i + 1) / words.length) * duration : endTime,
    IsPartOfWord: false,
  }));
}

/**
 * Parse standard LRC or Enhanced LRC (ELRC with <mm:ss.xx> word tags) into Spicy TTML AST shape.
 * Supports:
 * - Multi-timestamp line headers: [00:10.00][01:30.00] Text
 * - Inline word-level timestamps: [00:10.00] Word1 <00:10.50> Word2 <00:11.00> Word3
 * - Background vocal separation: "Lead Vocal (Background Vocal)" -> Lead & Background groups
 * - Instrumental break / Outro markers: empty timestamp lines set EndTime of preceding line
 */
export function parseLrcToTTML(lrcText) {
  if (!lrcText || typeof lrcText !== "string") return null;

  const rawLines = lrcText.split(/\r?\n/);
  const parsedEntries = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const headerRegex = /^((?:\[\d{1,3}:\d{2}(?:[.:]\d{2,3})?\])+)(.*)/;
    const match = trimmed.match(headerRegex);
    if (!match) continue;

    const headersStr = match[1];
    const restText = match[2] || "";

    const tsMatches = headersStr.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g);
    for (const tm of tsMatches) {
      const mins = parseFloat(tm[1]) || 0;
      const secs = parseFloat(tm[2]) || 0;
      const ms = tm[3] ? parseFloat(tm[3]) / (tm[3].length === 3 ? 1000 : 100) : 0;
      const time = mins * 60 + secs + ms;
      parsedEntries.push({ time, text: restText });
    }
  }

  if (parsedEntries.length === 0) return null;

  parsedEntries.sort((a, b) => a.time - b.time);

  const content = [];

  for (let i = 0; i < parsedEntries.length; i++) {
    const entry = parsedEntries[i];
    const text = entry.text.trim();

    if (!text) continue;

    const nextEntry = parsedEntries.slice(i + 1).find((e) => e.time > entry.time);
    const nextTime = nextEntry ? nextEntry.time : entry.time + 3.5;
    const defaultEndTime = Math.max(entry.time + 1, nextTime);

    const hasInlineTimestamps = /<\d{1,3}:\d{2}(?:[.:]\d{2,3})?>/.test(text);

    let leadSyllables = [];
    let lineEndTime = defaultEndTime;
    let bgText = null;
    let leadText = text;

    if (!hasInlineTimestamps) {
      const bgMatch = text.match(/^(.*?)\(([^)]+)\)(.*)$/);
      if (bgMatch) {
        const beforeBg = bgMatch[1].trim();
        const insideBg = bgMatch[2].trim();
        const afterBg = bgMatch[3].trim();
        leadText = [beforeBg, afterBg].filter(Boolean).join(" ");
        bgText = insideBg;
      }
    }

    if (hasInlineTimestamps) {
      const tokenRegex = /(?:<(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?>)?([^<]+)/g;
      const tokens = [];
      let matchToken;

      while ((matchToken = tokenRegex.exec(text)) !== null) {
        const tMins = matchToken[1] ? parseFloat(matchToken[1]) : null;
        const tSecs = matchToken[2] ? parseFloat(matchToken[2]) : null;
        const tMs = matchToken[3]
          ? parseFloat(matchToken[3]) / (matchToken[3].length === 3 ? 1000 : 100)
          : 0;

        let tTime = entry.time;
        if (tMins !== null && tSecs !== null) {
          tTime = tMins * 60 + tSecs + tMs;
        }

        const rawVal = matchToken[4];
        if (rawVal) {
          tokens.push({ time: tTime, rawText: rawVal });
        }
      }

      if (tokens.length > 0) {
        for (let k = 0; k < tokens.length; k++) {
          const tok = tokens[k];
          const nextTokTime = tokens[k + 1] ? tokens[k + 1].time : defaultEndTime;
          const sStart = tok.time;
          const sEnd = Math.max(sStart + 0.1, nextTokTime);

          const words = tok.rawText.split(/(\s+)/);
          let currentWord = "";

          for (let wIdx = 0; wIdx < words.length; wIdx++) {
            const chunk = words[wIdx];
            if (!chunk) continue;

            if (/^\s+$/.test(chunk)) {
              if (currentWord) {
                leadSyllables.push({
                  Text: currentWord,
                  StartTime: sStart,
                  EndTime: sEnd,
                  IsPartOfWord: false,
                });
                currentWord = "";
              }
            } else {
              currentWord += chunk;
              if (wIdx === words.length - 1 || !/^\s+$/.test(words[wIdx + 1] || "")) {
                const isLastInToken = wIdx === words.length - 1;
                leadSyllables.push({
                  Text: currentWord,
                  StartTime: sStart,
                  EndTime: sEnd,
                  IsPartOfWord: isLastInToken && !/\s$/.test(tok.rawText),
                });
                currentWord = "";
              }
            }
          }
        }
        lineEndTime = Math.max(defaultEndTime, tokens[tokens.length - 1].time + 0.5);
      }
    }

    if (leadSyllables.length === 0) {
      leadSyllables = splitLineToSyllables(leadText || text, entry.time, defaultEndTime);
    }

    const lineObj = {
      Lead: {
        StartTime: entry.time,
        EndTime: lineEndTime,
        Syllables: leadSyllables,
      },
      OppositeAligned: false,
    };

    if (bgText) {
      const bgSylls = splitLineToSyllables(bgText, entry.time, defaultEndTime);
      lineObj.Background = {
        StartTime: entry.time,
        EndTime: defaultEndTime,
        Syllables: bgSylls,
      };
    }

    content.push(lineObj);
  }

  if (content.length === 0) return null;

  return { Content: content, Type: "Syllable" };
}
