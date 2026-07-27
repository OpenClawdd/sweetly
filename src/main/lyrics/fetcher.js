import { getCustomLyrics } from "./sources/custom.js";
import { findAppleMusicLyrics } from "../appleMusicApi.js";
import { fetchBiniLyrics } from "./sources/binilyrics.js";
import { fetchLRCLib } from "./sources/lrclib.js";
import { fetchGenius } from "./sources/genius.js";
import { scrapeSpotifySearch, fetchSpicyLyricsData } from "./sources/spotify.js";

export async function fetchLyricsData(name, artist) {
  console.log("[Sweetly-Main] fetchLyricsData:", name, artist);

  const customData = getCustomLyrics(name, artist);
  if (customData) {
    console.log("[Sweetly-Main] Using custom lyrics");
    return { data: customData, artworkUrl: null };
  }

  // Fetch Apple Music catalog search in parallel for album artwork
  const appleResultPromise = findAppleMusicLyrics(name, artist);

  // 1. Query Spicy-Sparks lrc-api / BiniLyrics FIRST for community TTMLs!
  try {
    const biniLyrics = await fetchBiniLyrics(name, artist);
    if (biniLyrics) {
      console.log("[Sweetly-Main] Successfully fetched community TTML from Spicy-Sparks/lrc-api for:", name);
      const appleResult = await appleResultPromise;
      return { data: biniLyrics, artworkUrl: appleResult?.artworkUrl || null };
    }
  } catch (e) {
    console.log("[Sweetly-Main] Spicy-Sparks lrc-api fetch attempt failed:", e.message);
  }

  // 2. Query SpicyLyrics API for community TTMLs
  try {
    const spotifyId = await scrapeSpotifySearch(`${name} ${artist}`) || await scrapeSpotifySearch(name);
    if (spotifyId) {
      const spicyData = await fetchSpicyLyricsData(spotifyId);
      if (spicyData) {
        console.log("[Sweetly-Main] Successfully fetched community TTML from spicylyrics.org for:", name);
        const appleResult = await appleResultPromise;
        return { data: spicyData, artworkUrl: appleResult?.artworkUrl || null };
      }
    }
  } catch (e) {
    console.log("[Sweetly-Main] SpicyLyrics fetch attempt failed:", e.message);
  }

  const appleResult = await appleResultPromise;
  const appleLyrics = appleResult?.lyrics;
  const appleArtwork = appleResult?.artworkUrl;

  // 2. Fallback to Apple Music word-level TTML
  if (appleLyrics?.Content) {
    const wordCount = appleLyrics.Content.reduce((sum, line) => sum + (line.Lead?.Syllables?.length || 0), 0);
    const isWordLevel = wordCount > appleLyrics.Content.length * 1.3;
    console.log("[Sweetly-Main] Apple Music:", appleLyrics.Content.length, "lines,", wordCount, "words, wordLevel:", isWordLevel);
    if (isWordLevel) {
      return { data: appleLyrics, artworkUrl: appleArtwork || null };
    }
  }

  // 3. Fallbacks (BiniLyrics, LRCLIB, Genius, Apple Music line-level)
  const biniLyrics = await fetchBiniLyrics(name, artist);
  if (biniLyrics) {
    console.log("[Sweetly-Main] Got word-level lyrics from BiniLyrics");
    return { data: biniLyrics, artworkUrl: appleArtwork || null };
  }

  const lrclib = await fetchLRCLib(name, artist);
  if (lrclib) {
    console.log("[Sweetly-Main] Got lyrics from LRCLIB");
    return { data: lrclib, artworkUrl: appleArtwork || null };
  }

  const genius = await fetchGenius(name, artist);
  if (genius) {
    console.log("[Sweetly-Main] Got lyrics from Genius");
    return { data: genius, artworkUrl: appleArtwork || null };
  }

  if (appleLyrics) {
    console.log("[Sweetly-Main] Falling back to Apple Music line-level");
    return { data: appleLyrics, artworkUrl: appleArtwork || null };
  }
  if (appleArtwork) return { data: null, artworkUrl: appleArtwork };
  return null;
}
