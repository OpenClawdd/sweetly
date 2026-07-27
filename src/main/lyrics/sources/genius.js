import { SEARCH_UA } from "../utils.js";

export async function fetchGenius(name, artist) {
  try {
    const q = encodeURIComponent(`${name} ${artist}`);
    const searchRes = await fetch(`https://genius.com/api/search/song?q=${q}`, {
      headers: { "User-Agent": SEARCH_UA, "Accept": "application/json", "x-genius-request": "web" },
    });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const hits = searchData?.response?.sections?.[0]?.hits;
    if (!hits?.length) return null;
    const path = hits[0]?.result?.path;
    if (!path) return null;

    const pageRes = await fetch(`https://genius.com${path}`, {
      headers: { "User-Agent": SEARCH_UA },
    });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();
    const lyricsMatch = html.match(/<div[^>]*data-lyrics-container[^>]*>([\s\S]*?)<\/div>/);
    if (!lyricsMatch) return null;
    const rawLyrics = lyricsMatch[1].replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
    const lines = rawLyrics.split("\n").filter(Boolean).map((text) => ({
      Lead: { StartTime: 0, EndTime: 0, Syllables: [{ Text: text.trim(), StartTime: 0, EndTime: 0, IsPartOfWord: false }] },
      OppositeAligned: false,
    }));
    return lines.length > 0 ? { Content: lines, Type: "Line" } : null;
  } catch (e) {
    console.log("[Sweetly-Main] Genius error:", e.message);
    return null;
  }
}
