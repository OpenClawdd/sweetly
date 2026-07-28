import { getCustomLyrics } from "./sources/custom.js";
import { findAppleMusicLyrics } from "../appleMusicApi.js";
import { fetchBiniLyrics } from "./sources/binilyrics.js";
import { fetchLRCLib } from "./sources/lrclib.js";
import { fetchGenius } from "./sources/genius.js";
import { scrapeSpotifySearch, fetchSpicyLyricsData } from "./sources/spotify.js";
import { triggerAutoAlignment } from "./autoAligner.js";
import { pickAlignmentText, toLineAnchors } from "./utils.js";

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
  return data.Content
    .map((line) => {
      const parts = [];
      for (const group of [line.Lead, line.Background]) {
        if (!group?.Syllables?.length) continue;
        parts.push(group.Syllables.map((s) => s.Text).join("").trim());
      }
      return parts.join(" ").trim();
    })
    .filter(Boolean)
    .join("\n");
}

export async function fetchLyricsData(name, artist, album, playback = {}) {
  console.log("[Sweetly-Main] fetchLyricsData:", name, artist, "album:", album);

  // Kicked off first so the network round-trip overlaps the local disk check.
  const appleResultPromise = safe("apple", () => findAppleMusicLyrics(name, artist, album));

  // 1. User-supplied / AI-aligned TTML in ~/.sweetly-custom
  const customData = await safe("custom", () => getCustomLyrics(name, artist, playback.duration));
  if (customData) {
    console.log("[Sweetly-Main] Using custom local lyrics for:", name);
    const appleResult = await appleResultPromise;
    return { data: customData, provider: "spicylyrics", artworkUrl: appleResult?.artworkUrl || null };
  }

  const appleResult = await appleResultPromise;
  const appleLyrics = appleResult?.lyrics;
  const appleArtwork = appleResult?.artworkUrl || null;

  // 2. Apple Music, but only when it actually came back syllable-level
  if (appleLyrics?.Content) {
    const wordCount = appleLyrics.Content.reduce((sum, line) => sum + (line.Lead?.Syllables?.length || 0), 0);
    const isWordLevel = wordCount > appleLyrics.Content.length * 1.3;
    console.log("[Sweetly-Main] Apple Music:", appleLyrics.Content.length, "lines,", wordCount, "words, wordLevel:", isWordLevel);
    if (isWordLevel) {
      console.log("[Sweetly-Main] Using native Apple Music syllable-level TTML for:", name);
      return { data: appleLyrics, provider: "apple", artworkUrl: appleArtwork };
    }
  }

  // 3. BiniLyrics — community word-level TTML
  const biniLyrics = await safe("binilyrics", () => fetchBiniLyrics(name, artist));
  if (biniLyrics) {
    console.log("[Sweetly-Main] Got word-level community TTML from BiniLyrics for:", name);
    return { data: biniLyrics, provider: "spicylyrics", artworkUrl: appleArtwork };
  }

  // 4. spicylyrics.org, keyed by a scraped Spotify track id
  const spicyData = await safe("spicylyrics", async () => {
    const spotifyId = (await scrapeSpotifySearch(`${name} ${artist}`)) || (await scrapeSpotifySearch(name));
    return spotifyId ? await fetchSpicyLyricsData(spotifyId) : null;
  });
  if (spicyData) {
    console.log("[Sweetly-Main] Got community TTML from spicylyrics.org for:", name);
    return { data: spicyData, provider: "spicylyrics", artworkUrl: appleArtwork };
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
      "[Sweetly-Main] Alignment target:", alignTarget.source,
      anchors.length ? `(${anchors.length} anchored lines)` : "(unanchored)",
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
    }),
  );
  if (alignResult && !alignResult.started) {
    console.log("[Sweetly-Main] Aligner skipped:", alignResult.reason);
  }

  // 5. Apple Music line-level — but only if it actually carries timings.
  // Unsynced plain text is worse than LRCLIB's synced LRC, so it waits.
  if (appleLyrics && !appleLyrics.Unsynced) {
    console.log("[Sweetly-Main] Fallback to Apple Music line-level TTML");
    return { data: appleLyrics, provider: "apple", artworkUrl: appleArtwork };
  }

  // 6. LRCLIB (line-level LRC), then Genius (plain text).
  // Already fetched above, because the aligner needed its text and anchors.
  if (lrcLib) {
    console.log("[Sweetly-Main] Got synced lyrics from LRCLIB");
    return { data: lrcLib, provider: "lrclib", artworkUrl: appleArtwork };
  }

  // 7. Nothing synced exists — fall back to Apple's unsynced text so the
  // words are at least readable.
  if (appleLyrics) {
    console.log("[Sweetly-Main] Falling back to Apple Music UNSYNCED text");
    return { data: appleLyrics, provider: "apple", artworkUrl: appleArtwork };
  }

  const genius = await safe("genius", () => fetchGenius(name, artist));
  if (genius) {
    console.log("[Sweetly-Main] Fallback to Genius plain text");
    return { data: genius, provider: "genius", artworkUrl: appleArtwork };
  }

  if (appleArtwork) return { data: null, provider: "apple", artworkUrl: appleArtwork };
  return null;
}
