export const SPICY_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export const SEARCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export function parseTTMLTime(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  const clean = String(ts).replace(/s$/i, "").replace(/^['"]+|['"]+$/g, "").trim();
  if (!clean) return 0;
  const parts = clean.split(":");
  if (parts.length === 3) return parseFloat(parts[0] || 0) * 3600 + parseFloat(parts[1] || 0) * 60 + parseFloat(parts[2] || 0);
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

    const text = lead.Syllables.map((s) => s?.Text ?? "").join(" ").replace(/\s+/g, " ").trim();
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
