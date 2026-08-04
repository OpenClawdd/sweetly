const INLINE_TS_RE = /<\d{1,3}:\d{2}(?:[.:]\d{2,3})?>/;

function parseTimestamp(mins, secs, fraction) {
  const ms = fraction ? Number(fraction) / (fraction.length === 3 ? 1000 : 100) : 0;
  return Number(mins) * 60 + Number(secs) + ms;
}

function normaliseText(text) {
  return String(text || "")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function syllableGuess(word) {
  const clean = word.toLowerCase().replace(/[^a-z0-9']/g, "");
  if (!clean) return 1;
  return Math.max(1, (clean.match(/[aeiouy]+/g) || []).length);
}

function wordWeight(word, index, count) {
  let weight = 0.55 + syllableGuess(word) * 0.42 + Math.min(word.length, 12) * 0.025;
  if (/[,;:]$/.test(word)) weight += 0.18;
  if (/[.!?]$/.test(word)) weight += 0.3;
  if (/^\(.+\)$/.test(word)) weight *= 0.78;
  if (index === count - 1) weight += 0.18;
  return Math.max(0.35, weight);
}

export function splitWeightedWords(text, startTime, endTime) {
  const words = normaliseText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const duration = Math.max(0, endTime - startTime);
  if (!duration) {
    return words.map((Text) => ({ Text, StartTime: startTime, EndTime: endTime, IsPartOfWord: false }));
  }

  const weights = words.map((word, i) => wordWeight(word, i, words.length));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = startTime;

  return words.map((Text, i) => {
    const isLast = i === words.length - 1;
    const span = isLast ? endTime - cursor : (duration * weights[i]) / total;
    const StartTime = cursor;
    const EndTime = Math.max(StartTime + 0.06, isLast ? endTime : StartTime + span);
    cursor = EndTime;
    return { Text, StartTime, EndTime, IsPartOfWord: false };
  });
}

function parseInlineWords(text, lineStart, lineEnd) {
  const tokenRegex = /(?:<(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?>)?([^<]+)/g;
  const tokens = [];
  let match;
  while ((match = tokenRegex.exec(text)) !== null) {
    const rawText = normaliseText(match[4]);
    if (!rawText) continue;
    const time = match[1] === undefined ? lineStart : parseTimestamp(match[1], match[2], match[3]);
    tokens.push({ time, rawText });
  }

  const result = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1]?.time ?? lineEnd;
    result.push(...splitWeightedWords(token.rawText, token.time, Math.max(token.time + 0.06, next)));
  }
  return result;
}

function splitBackground(text) {
  const match = text.match(/^(.*?)\s*\(([^()]*)\)\s*(.*)$/);
  if (!match) return { lead: text, background: null };
  const lead = normaliseText([match[1], match[3]].filter(Boolean).join(" "));
  const background = normaliseText(match[2]);
  return { lead: lead || text, background: background || null };
}

export function parseLrcToTTML(lrcText) {
  if (typeof lrcText !== "string" || !lrcText.trim()) return null;
  const entries = [];
  for (const rawLine of lrcText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^((?:\[\d{1,3}:\d{2}(?:[.:]\d{2,3})?\])+)(.*)$/);
    if (!match) continue;
    for (const ts of match[1].matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g)) {
      entries.push({ time: parseTimestamp(ts[1], ts[2], ts[3]), text: match[2] || "" });
    }
  }
  if (!entries.length) return null;
  entries.sort((a, b) => a.time - b.time);

  const Content = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const text = normaliseText(entry.text);
    if (!text) continue;
    const nextTime = entries.slice(i + 1).find((candidate) => candidate.time > entry.time)?.time ?? entry.time + 3.5;
    const end = Math.max(entry.time + 0.6, nextTime);
    const hasInline = INLINE_TS_RE.test(text);
    const { lead, background } = hasInline ? { lead: text, background: null } : splitBackground(text);
    const Syllables = hasInline ? parseInlineWords(text, entry.time, end) : splitWeightedWords(lead, entry.time, end);
    if (!Syllables.length) continue;

    const line = {
      Lead: { StartTime: entry.time, EndTime: end, Syllables },
      OppositeAligned: false,
      Semantic: {
        isAdlib: /^\(.+\)$/.test(text),
        hasBackground: Boolean(background),
        repeatedTextKey: normaliseText(lead).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      },
    };

    if (background) {
      line.Background = {
        StartTime: entry.time,
        EndTime: end,
        Syllables: splitWeightedWords(background, entry.time, end),
      };
    }
    Content.push(line);
  }

  return Content.length ? { Content, Type: "Syllable", TimingQuality: "inferred-word" } : null;
}
