/**
 * Bulk Community TTML Fetcher & Cacher
 *
 * Downloads studio and community word-level TTML files from BiniLyrics
 * (the open repository backing SpicyLyrics) and saves them into ~/.sweetly-custom/
 */
// Writes through saveCustomLyrics rather than a local slugifier. customKey.js
// exists because the reader, the aligner and the converter each had their own
// and disagreed, so files written by one were invisible to the others.
import { saveCustomLyrics } from "../src/main/lyrics/sources/custom.js";

export async function cacheTrackTTML(trackName, artistName) {
  const query = `${trackName} ${artistName}`.trim();

  console.log(`[CacheTTML] Searching BiniLyrics for: "${query}"...`);
  try {
    const searchUrl = `https://lyrics-api.binimum.org/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "SweetlyOverlay/1.0.0", Accept: "application/json" },
    });
    if (!res.ok) {
      console.log(`[CacheTTML] Search failed (${res.status}) for "${query}"`);
      return false;
    }

    const data = await res.json();
    const results = data?.results || [];
    const wordMatch = results.find((r) => r.timing_type === "word");

    if (!wordMatch || !wordMatch.lyricsUrl) {
      console.log(`[CacheTTML] No word-level community TTML found for "${query}"`);
      return false;
    }

    console.log(
      `[CacheTTML] Found word TTML: ${wordMatch.track_name} by ${wordMatch.artist_name} (${wordMatch.lyricsUrl})`
    );
    const ttmlRes = await fetch(wordMatch.lyricsUrl, {
      headers: { "User-Agent": "SweetlyOverlay/1.0.0" },
    });

    if (!ttmlRes.ok) {
      console.log(`[CacheTTML] Download failed for ${wordMatch.lyricsUrl}`);
      return false;
    }

    const ttml = await ttmlRes.text();
    return saveCustomLyrics(trackName, artistName, ttml);
  } catch (e) {
    console.error(`[CacheTTML] Error:`, e.message);
    return false;
  }
}

// Command-line execution support: node scripts/cache_community_lyrics.js "SKELETONS" "Travis Scott"
if (process.argv[1]?.endsWith("cache_community_lyrics.js")) {
  const name = process.argv[2] || "SKELETONS";
  const artist = process.argv[3] || "Travis Scott";
  cacheTrackTTML(name, artist);
}
