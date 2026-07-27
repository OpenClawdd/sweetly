import { SEARCH_UA } from "../utils.js";

export async function fetchLRCLib(name, artist) {
  try {
    const q = encodeURIComponent(`${name} ${artist}`);
    const res = await fetch(`https://lrclib.net/api/search?q=${q}`, { headers: { "User-Agent": SEARCH_UA } });
    if (!res.ok) return null;
    const results = await res.json();
    if (!results?.length) return null;
    const match = results.find((r) => r.syncedLyrics) || results[0];
    if (!match?.syncedLyrics) return null;
    console.log("[Sweetly-Main] LRCLIB:", match.trackName, match.artistName);

    const lines = [];
    for (const raw of match.syncedLyrics.split("\n")) {
      const m = raw.match(/\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\](.*)/);
      if (!m) continue;
      const mins = parseFloat(m[1]) || 0;
      const secs = parseFloat(m[2]) || 0;
      const ms = m[3] ? parseFloat(m[3]) / (m[3].length === 3 ? 1000 : 100) : 0;
      const time = mins * 60 + secs + ms;
      const text = (m[4] || "").trim();
      if (!text) continue;
      lines.push({ Lead: { StartTime: time, EndTime: time + 3, Syllables: [{ Text: text, StartTime: time, EndTime: time + 3, IsPartOfWord: false }] }, OppositeAligned: false });
    }
    return lines.length > 0 ? { Content: lines, Type: "Line" } : null;
  } catch (e) {
    console.log("[Sweetly-Main] LRCLIB error:", e.message);
    return null;
  }
}
