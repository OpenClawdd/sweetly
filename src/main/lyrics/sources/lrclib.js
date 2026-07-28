import { SEARCH_UA, splitLineToSyllables } from "../utils.js";

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/\s*[([]\s*(feat|ft|with)\.?\s[^)\]]*[)\]]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchTrack(results, name, artist) {
  const normName = normalize(name);
  const normArtist = normalize(artist);
  const primaryArtist = normArtist.split(" ")[0];

  // Synced-only. LRCLIB often lists a tidily-titled plain-text row alongside a
  // scrappier row that actually carries the LRC; scoring both together let the
  // plain row win on metadata and then fail the `syncedLyrics` check below,
  // throwing away timings that were available. Since a caller without synced
  // lyrics gets nothing anyway, unsynced rows should never enter the contest.
  const candidates = (results || []).filter((r) => r.syncedLyrics);
  let bestMatch = null;
  let bestScore = -Infinity;

  for (const r of candidates) {
    const rName = normalize(r.trackName);
    const rArtist = normalize(r.artistName);

    let score = 0;
    if (rName === normName) score += 100;
    else if (rName.startsWith(normName) || normName.startsWith(rName)) score += 60;
    else if (rName.includes(normName) || normName.includes(rName)) score += 30;
    else score -= 80;

    if (rArtist === normArtist) score += 60;
    else if (rArtist.includes(normArtist) || normArtist.includes(rArtist) || (primaryArtist && rArtist.includes(primaryArtist))) score += 30;
    else score -= 40;

    if (r.syncedLyrics) score += 20;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = r;
    }
  }

  return bestScore >= 40 ? bestMatch : null;
}

export async function fetchLRCLib(name, artist) {
  try {
    const q = encodeURIComponent(`${name} ${artist}`);
    const res = await fetch(`https://lrclib.net/api/search?q=${q}`, { headers: { "User-Agent": SEARCH_UA } });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results?.length) return null;
    const match = matchTrack(results, name, artist);
    if (!match?.syncedLyrics) return null;
    console.log("[Sweetly-Main] LRCLIB:", match.trackName, match.artistName);

    const parsedLines = [];
    for (const raw of match.syncedLyrics.split("\n")) {
      const m = raw.match(/\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\](.*)/);
      if (!m) continue;
      const mins = parseFloat(m[1]) || 0;
      const secs = parseFloat(m[2]) || 0;
      const ms = m[3] ? parseFloat(m[3]) / (m[3].length === 3 ? 1000 : 100) : 0;
      const time = mins * 60 + secs + ms;
      const text = (m[4] || "").trim();
      if (!text) continue;
      parsedLines.push({ time, text });
    }

    const lines = parsedLines.map((line, idx) => {
      const nextTime = parsedLines[idx + 1]?.time ?? (line.time + 3);
      const endTime = Math.max(line.time + 1, nextTime);
      const syllables = splitLineToSyllables(line.text, line.time, endTime);
      return {
        Lead: { StartTime: line.time, EndTime: endTime, Syllables: syllables },
        OppositeAligned: false,
      };
    });

    return lines.length > 0 ? { Content: lines, Type: "Syllable" } : null;
  } catch (e) {
    console.log("[Sweetly-Main] LRCLIB error:", e.message);
    return null;
  }
}
