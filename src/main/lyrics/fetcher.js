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

  const appleResult = await findAppleMusicLyrics(name, artist);
  const appleLyrics = appleResult?.lyrics;
  const appleArtwork = appleResult?.artworkUrl;

  if (appleLyrics?.Content) {
    const wordCount = appleLyrics.Content.reduce((sum, line) => sum + (line.Lead?.Syllables?.length || 0), 0);
    const isWordLevel = wordCount > appleLyrics.Content.length * 1.3;
    console.log("[Sweetly-Main] Apple Music:", appleLyrics.Content.length, "lines,", wordCount, "words, wordLevel:", isWordLevel);
    if (isWordLevel) {
      return { data: appleLyrics, artworkUrl: appleArtwork || null };
    }
  }

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

  const spotifyId = await scrapeSpotifySearch(`${name} ${artist}`) || await scrapeSpotifySearch(name);
  if (spotifyId) {
    const spicyData = await fetchSpicyLyricsData(spotifyId);
    if (spicyData) {
      console.log("[Sweetly-Main] Got lyrics from spicylyrics");
      return { data: spicyData, artworkUrl: appleArtwork || null };
    }
  }

  if (appleLyrics) {
    console.log("[Sweetly-Main] Falling back to Apple Music line-level");
    return { data: appleLyrics, artworkUrl: appleArtwork || null };
  }
  if (appleArtwork) return { data: null, artworkUrl: appleArtwork };
  return null;
}
