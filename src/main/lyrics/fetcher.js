import { getCustomLyrics } from "./sources/custom.js";
import { findAppleMusicLyrics } from "../appleMusicApi.js";
import { fetchBiniLyrics } from "./sources/binilyrics.js";
import { fetchLRCLib } from "./sources/lrclib.js";
import { fetchGenius } from "./sources/genius.js";
import { scrapeSpotifySearch, fetchSpicyLyricsData } from "./sources/spotify.js";
import { triggerAutoAlignment } from "./autoAligner.js";

export async function fetchLyricsData(name, artist, album) {
  console.log("[Sweetly-Main] fetchLyricsData:", name, artist, "album:", album);

  const customData = getCustomLyrics(name, artist);
  if (customData) {
    console.log("[Sweetly-Main] Using custom lyrics");
    return { data: customData, artworkUrl: null };
  }

  // 1. Fetch Apple Music catalog search FIRST for native syllable-level TTML and artwork!
  const appleResult = await findAppleMusicLyrics(name, artist, album);
  const appleLyrics = appleResult?.lyrics;
  const appleArtwork = appleResult?.artworkUrl;

  if (appleLyrics?.Content) {
    const wordCount = appleLyrics.Content.reduce((sum, line) => sum + (line.Lead?.Syllables?.length || 0), 0);
    const isWordLevel = wordCount > appleLyrics.Content.length * 1.3;
    console.log("[Sweetly-Main] Apple Music:", appleLyrics.Content.length, "lines,", wordCount, "words, wordLevel:", isWordLevel);
    if (isWordLevel) {
      console.log("[Sweetly-Main] Using native Apple Music syllable-level TTML for:", name);
      return { data: appleLyrics, provider: "apple", artworkUrl: appleArtwork || null };
    }
  }

  // 2. Query Spicy-Sparks lrc-api / BiniLyrics SECOND for genuine community word-level TTML!
  try {
    const biniLyrics = await fetchBiniLyrics(name, artist);
    if (biniLyrics) {
      console.log("[Sweetly-Main] Successfully fetched word-level community TTML from Spicy-Sparks/lrc-api for:", name);
      return { data: biniLyrics, provider: "spicylyrics", artworkUrl: appleArtwork || null };
    }
  } catch (e) {
    console.log("[Sweetly-Main] Spicy-Sparks lrc-api fetch attempt failed:", e.message);
  }

  // 3. Query SpicyLyrics API for community word-level TTML
  try {
    const spotifyId = await scrapeSpotifySearch(`${name} ${artist}`) || await scrapeSpotifySearch(name);
    if (spotifyId) {
      const spicyData = await fetchSpicyLyricsData(spotifyId);
      if (spicyData) {
        console.log("[Sweetly-Main] Successfully fetched community TTML from spicylyrics.org for:", name);
        return { data: spicyData, provider: "spicylyrics", artworkUrl: appleArtwork || null };
      }
    }
  } catch (e) {
    console.log("[Sweetly-Main] SpicyLyrics fetch attempt failed:", e.message);
  }

  // Trigger background AI Auto-Aligner for tracks missing word-level TTML
  triggerAutoAlignment(name, artist);

  // 4. Fallback to Apple Music line-level TTML
  if (appleLyrics) {
    console.log("[Sweetly-Main] Fallback to Apple Music line-level TTML");
    return { data: appleLyrics, provider: "apple", artworkUrl: appleArtwork || null };
  }

  // 5. Fallbacks (LRCLIB, Genius)
  const lrcLib = await fetchLRCLib(name, artist);
  if (lrcLib) {
    console.log("[Sweetly-Main] Got synced lyrics from LRCLIB");
    return { data: lrcLib, provider: "lrclib", artworkUrl: appleArtwork || null };
  }

  const genius = await fetchGenius(name, artist);
  if (genius) {
    console.log("[Sweetly-Main] Fallback to Genius plain text");
    return { data: genius, provider: "genius", artworkUrl: appleArtwork || null };
  }

  if (appleArtwork) return { data: null, provider: "apple", artworkUrl: appleArtwork };
  return null;
}
