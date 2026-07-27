/**
 * Replaces upstream's utils/Lyrics/fetchLyrics.ts.
 *
 * The main process owns provider selection, track matching, alignment and
 * caching. This only normalises what comes back into the tuple ApplyLyrics
 * expects: [content | descriptor, httpStatus].
 *
 * The real response shape, from src/main/index.js and src/main/lyrics/fetcher.js:
 *   null                                              nothing found
 *   { data: null,              provider, artworkUrl }  artwork only
 *   { data: { Type, Content }, provider, artworkUrl }  already Spicy-shaped
 */
import { getMusicState } from "../adapter/musicState.ts";
import { setArtworkUrl } from "../adapter/AppleMusicPlayer.ts";
import { parseLocalTTML, type SpicyLyrics } from "./toSpicyShape.ts";

export type LyricsResult = [SpicyLyrics | string, number];

/**
 * Sources emit { Content, Type } without StartTime, but Syllable.ts reads it at
 * `data.StartTime >= getLyricsBetweenShow()` to decide whether to render the
 * leading musical-dots line. Comparing against undefined silently skips it, so
 * derive the value from the first entry instead.
 */
function withStartTime(data: Record<string, any>): Record<string, any> {
  if (typeof data.StartTime === "number") return data;
  const first = data.Content?.[0];
  const derived = first?.Lead?.StartTime ?? first?.StartTime ?? 0;
  return { ...data, StartTime: derived };
}

/**
 * Syllable.ts treats every line's Background as an array — `line.Background
 * ?.some(...)` at line 90, `.forEach(...)` at 322. Some of our sources emit a
 * single object instead, which throws "Background?.some is not a function" and
 * kills the whole render. Normalise rather than patching upstream.
 */
function withArrayBackgrounds(data: Record<string, any>): SpicyLyrics {
  if (data.Type !== "Syllable" || !Array.isArray(data.Content)) return data as SpicyLyrics;

  const Content = data.Content.map((line: any) => {
    if (!line || line.Background === undefined || line.Background === null) return line;
    if (Array.isArray(line.Background)) return line;
    return { ...line, Background: [line.Background] };
  });

  return { ...data, Content } as SpicyLyrics;
}

/** Pure. Everything testable about the fetch path lives here. */
export function normaliseLyricsResponse(response: unknown): LyricsResult {
  if (!response || typeof response !== "object") return ["lyrics-not-found", 404];

  const { data } = response as Record<string, any>;

  if (data === null || data === undefined) return ["lyrics-not-found", 404];

  // Defensive: the main process parses TTML today, but handle a raw document so
  // a future source change degrades to line-level rather than rendering nothing.
  if (typeof data === "string") {
    const parsed = parseLocalTTML(data);
    return parsed ? [parsed, 200] : ["unknown-error", 500];
  }

  if (typeof data === "object" && typeof data.Type === "string") {
    return [withArrayBackgrounds(withStartTime(data)), 200];
  }

  return ["unknown-error", 500];
}

export async function fetchLyricsForCurrentTrack(): Promise<LyricsResult> {
  const track = getMusicState().track;
  if (!track) return ["unknown-track", 404];

  const api = (globalThis as unknown as { electronAPI?: any }).electronAPI;
  if (!api?.fetchLyrics) return ["unknown-error", 500];

  try {
    const response = await api.fetchLyrics({
      name: track.nameCleaned,
      artist: track.artistCleaned,
      album: track.album,
    });

    // Artwork rides along on this response — AppleScript gives us no image.
    setArtworkUrl(response?.artworkUrl ?? null);

    const result = normaliseLyricsResponse(response);
    const [content] = result;
    console.log(
      "[Sweetly] lyrics:",
      typeof content === "string"
        ? content
        : `${content.Type} (${
            (content as any).Content?.length ?? (content as any).Lines?.length ?? 0
          } lines) via ${response?.provider}`,
    );
    return result;
  } catch (error) {
    console.error("[Sweetly] lyrics fetch failed:", error);
    return ["unknown-error", 500];
  }
}
