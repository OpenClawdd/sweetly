import { getCustomLyrics } from "./sources/custom.js";
import { findAppleMusicLyrics, fetchITunesArtwork } from "../appleMusicApi.js";
import { fetchBiniLyrics } from "./sources/binilyrics.js";
import { fetchLRCLib } from "./sources/lrclib.js";
import { fetchGenius } from "./sources/genius.js";
import { scrapeSpotifySearch, fetchSpicyLyricsData } from "./sources/spotify.js";
import { getSpotifyAccessToken } from "../spotifyAuth.js";
import { triggerAutoAlignment } from "./autoAligner.js";
import { pickAlignmentText, toLineAnchors } from "./utils.js";

const CACHE_MAX = 60;

const lyricsCache = new Map();

function makeCacheKey(name, artist) {
  return `${(name || "").trim().toLowerCase()}|||${(artist || "").trim().toLowerCase()}`;
}

function cacheGet(name, artist) {
  const key = makeCacheKey(name, artist);
  const entry = lyricsCache.get(key);
  if (entry) {
    lyricsCache.delete(key);
    lyricsCache.set(key, entry);
    return entry;
  }
  return null;
}

function cacheSet(name, artist, value) {
  if (!value || !value.data) return;
  const key = makeCacheKey(name, artist);
  if (lyricsCache.has(key)) lyricsCache.delete(key);
  lyricsCache.set(key, value);
  while (lyricsCache.size > CACHE_MAX) {
    const oldest = lyricsCache.keys().next().value;
    lyricsCache.delete(oldest);
  }
}

export function clearLyricsCache() {
  lyricsCache.clear();
}

/**
 * Run one lyrics source without letting it take down the pipeline.
 * A source that throws is worth a log line and nothing more — the next
 * source still gets its turn.
 */
async function safe(label, fn, fallback = null) {
  try {
    return await fn();
  } catch (e) {
    console.log(`[Sweetly-Main] source "${label}" failed:`, e.message);
    return fallback;
  }
}

/** Flatten parsed TTML JSON back to plain lines, for the forced aligner. */
function lyricsToPlainText(data) {
  if (!data?.Content) return "";
  return data.Content.map((line) => {
    const parts = [];
    for (const group of [line.Lead, line.Background]) {
      if (!group?.Syllables?.length) continue;
      parts.push(
        group.Syllables.map((s) => s.Text)
          .join("")
          .trim()
      );
    }
    return parts.join(" ").trim();
  })
    .filter(Boolean)
    .join("\n");
}

export async function fetchLyricsData(name, artist, album, playback = {}, opts = {}) {
  console.log("[Sweetly-Main] fetchLyricsData:", name, artist, "album:", album);

  const cached = cacheGet(name, artist);
  if (cached) {
    console.log("[Sweetly-Main] Lyrics cache HIT for:", name, artist);
    return cached;
  }

  // Kicked off first so the network round-trip overlaps the local disk check.
  const appleResultPromise = safe("apple", () => findAppleMusicLyrics(name, artist, album, opts));

  // 1. User-supplied / AI-aligned TTML in ~/.sweetly-custom
  //
  // Custom stays ahead of Apple Music. A file in this directory was put there
  // deliberately — hand-corrected or force-aligned against the actual audio —
  // so it is the one source that encodes an intent no provider can infer. It
  // briefly sat below Apple's word-level TTML on the theory that studio timings
  // always win; that silently ignored every locally aligned track for which
  // Apple also had word timings, which is most of them.
  const customData = await safe("custom", () =>
    getCustomLyrics(name, artist, playback.duration, opts)
  );
  const appleResult = await appleResultPromise;
  const appleLyrics = appleResult?.lyrics;
  let appleArtwork = playback.artworkUrl || appleResult?.artworkUrl || null;

  if (!appleArtwork) {
    appleArtwork = await safe("itunes-artwork", () => fetchITunesArtwork(name, artist, album));
  }

  if (customData) {
    console.log("[Sweetly-Main] Using custom local lyrics for:", name);
    customData.Provider = "Spicy Lyrics";
    customData.IsCommunity = true;
    const result = { data: customData, provider: "spicylyrics", artworkUrl: appleArtwork };
    cacheSet(name, artist, result);
    return result;
  }

  // 2. Apple Music native syllable-level TTML (studio word timings)
  if (appleLyrics?.Content) {
    const isWordLevel = appleLyrics.Timing?.toLowerCase() === "word";
    console.log(
      "[Sweetly-Main] Apple Music:",
      appleLyrics.Content.length,
      "lines, timing:",
      appleLyrics.Timing || "unset",
      "isWordLevel:",
      isWordLevel
    );
    if (isWordLevel) {
      console.log("[Sweetly-Main] Using native Apple Music syllable-level TTML for:", name);
      appleLyrics.Provider = "Apple Music";
      appleLyrics.IsCommunity = false;
      const result = { data: appleLyrics, provider: "apple", artworkUrl: appleArtwork };
      cacheSet(name, artist, result);
      return result;
    }
  }

  const biniLyrics = await safe("binilyrics", () => fetchBiniLyrics(name, artist));
  if (biniLyrics) {
    console.log("[Sweetly-Main] Got word-level community TTML from BiniLyrics for:", name);
    biniLyrics.Provider = "Spicy Lyrics";
    biniLyrics.IsCommunity = true;
    const result = { data: biniLyrics, provider: "spicylyrics", artworkUrl: appleArtwork };
    cacheSet(name, artist, result);
    return result;
  }

  const spicyData = await safe("spicylyrics", async () => {
    const spotifyId =
      (await scrapeSpotifySearch(name, artist)) || (await scrapeSpotifySearch(`${name} ${artist}`));
    // Non-interactive: a lyrics fetch must never pop a browser window mid-track.
    // The token is null when the user hasn't signed in, in which case the API
    // answers 401 and the chain falls through to the next source.
    const spotifyToken = await getSpotifyAccessToken();
    return spotifyId ? await fetchSpicyLyricsData(spotifyId, spotifyToken) : null;
  });
  if (spicyData) {
    console.log("[Sweetly-Main] Got community TTML from spicylyrics.org for:", name);
    spicyData.Provider = "Spicy Lyrics";
    spicyData.IsCommunity = true;
    const result = { data: spicyData, provider: "spicylyrics", artworkUrl: appleArtwork };
    cacheSet(name, artist, result);
    return result;
  }

  // LRCLIB is fetched here rather than at its own step below, because the
  // aligner needs two things from it: uncensored text (Apple masks words on
  // most of this library) and line-level time windows to anchor against.
  const lrcLib = await safe("lrclib", () => fetchLRCLib(name, artist));

  // Nothing word-level exists anywhere. Capture the audio as it plays and
  // derive timings from the cleanest untimed text we have.
  const alignTarget = pickAlignmentText([
    { source: "lrclib", text: lyricsToPlainText(lrcLib) },
    { source: "apple", text: lyricsToPlainText(appleLyrics) },
  ]);
  // Anchors only come from the source whose text we actually chose — mixing
  // one source's windows with another's wording would misalign every line.
  const anchors = alignTarget?.source === "lrclib" ? toLineAnchors(lrcLib) : [];
  if (alignTarget) {
    console.log(
      "[Sweetly-Main] Alignment target:",
      alignTarget.source,
      anchors.length ? `(${anchors.length} anchored lines)` : "(unanchored)"
    );
  }

  const alignResult = await safe("auto-aligner", () =>
    triggerAutoAlignment({
      name,
      artist,
      duration: playback.duration,
      position: playback.position ?? 0,
      lyricsText: alignTarget?.text ?? "",
      anchors,
    })
  );
  if (alignResult && !alignResult.started) {
    console.log("[Sweetly-Main] Aligner skipped:", alignResult.reason);
  }

  // 5. Apple Music line-level — but only if it actually carries timings.
  // Unsynced plain text is worse than LRCLIB's synced LRC, so it waits.
  if (appleLyrics && !appleLyrics.Unsynced) {
    console.log("[Sweetly-Main] Fallback to Apple Music line-level TTML");
    appleLyrics.Provider = "Apple Music (Line-Synced, Translated to TTML)";
    appleLyrics.IsCommunity = false;
    const result = { data: appleLyrics, provider: "apple", artworkUrl: appleArtwork };
    cacheSet(name, artist, result);
    return result;
  }

  // 6. LRCLIB (line-level LRC), then Genius (plain text).
  // Already fetched above, because the aligner needed its text and anchors.
  if (lrcLib) {
    console.log("[Sweetly-Main] Got synced lyrics from LRCLIB");
    lrcLib.Provider = "LRCLIB (Line-Synced)";
    lrcLib.IsCommunity = false;
    const result = { data: lrcLib, provider: "lrclib", artworkUrl: appleArtwork };
    cacheSet(name, artist, result);
    return result;
  }

  // 7. Nothing synced exists — fall back to Apple's unsynced text so the
  // words are at least readable.
  if (appleLyrics) {
    console.log("[Sweetly-Main] Falling back to Apple Music UNSYNCED text");
    appleLyrics.Provider = "Apple Music (Unsynced)";
    appleLyrics.IsCommunity = false;
    const result = { data: appleLyrics, provider: "apple", artworkUrl: appleArtwork };
    cacheSet(name, artist, result);
    return result;
  }

  const genius = await safe("genius", () => fetchGenius(name, artist));
  if (genius) {
    console.log("[Sweetly-Main] Fallback to Genius plain text");
    const result = { data: genius, provider: "genius", artworkUrl: appleArtwork };
    cacheSet(name, artist, result);
    return result;
  }

  if (appleArtwork) return { data: null, provider: "apple", artworkUrl: appleArtwork };
  return null;
}
