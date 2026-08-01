import { SEARCH_UA, parseLrcToTTML } from "../utils.js";

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
    else if (
      rArtist.includes(normArtist) ||
      normArtist.includes(rArtist) ||
      (primaryArtist && rArtist.includes(primaryArtist))
    )
      score += 30;
    else score -= 40;

    if (r.syncedLyrics) score += 20;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = r;
    }
  }

  return bestScore >= 40 ? bestMatch : null;
}

const lrclibCache = new Map();

export function clearLRCLibCache() {
  lrclibCache.clear();
}

export async function fetchLRCLib(name, artist) {
  try {
    const cacheKey = `${name.toLowerCase()}:::${artist.toLowerCase()}`;
    if (lrclibCache.has(cacheKey)) {
      return lrclibCache.get(cacheKey);
    }

    const q = encodeURIComponent(`${name} ${artist}`);
    const res = await fetch(`https://lrclib.net/api/search?q=${q}`, {
      headers: { "User-Agent": SEARCH_UA },
    });
    if (!res.ok) {
      lrclibCache.set(cacheKey, null);
      return null;
    }
    const results = await res.json();
    if (!results?.length) {
      lrclibCache.set(cacheKey, null);
      return null;
    }
    const match = matchTrack(results, name, artist);
    if (!match?.syncedLyrics) {
      lrclibCache.set(cacheKey, null);
      return null;
    }
    console.log("[Sweetly-Main] LRCLIB:", match.trackName, match.artistName);

    const result = parseLrcToTTML(match.syncedLyrics);
    lrclibCache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.log("[Sweetly-Main] LRCLIB error:", e.message);
    return null;
  }
}
