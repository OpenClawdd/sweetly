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

/**
 * Ensures multi-word strings inside Syllables or Line text are split into
 * separate word syllables so Spicy's renderer applies proper word spacing.
 */
function expandSyllablesInLyrics(data: Record<string, any>): Record<string, any> {
  if (!data || !Array.isArray(data.Content)) return data;

  const Content = data.Content.map((item: any) => {
    if (!item) return item;

    if (item.Lead && Array.isArray(item.Lead.Syllables)) {
      const newSyllables: any[] = [];
      for (const s of item.Lead.Syllables) {
        if ($forceWordLevel.get() && s && typeof s.Text === "string" && /\s/.test(s.Text.trim())) {
          const words = s.Text.trim().split(/\s+/).filter(Boolean);
          const duration = s.EndTime > s.StartTime ? s.EndTime - s.StartTime : 0;
          words.forEach((w: string, wi: number) => {
            const wIsLast = s.IsPartOfWord ? (wi === words.length - 1) : false;
            const wStart = duration > 0 ? s.StartTime + (wi / words.length) * duration : s.StartTime;
            const wEnd = duration > 0 ? s.StartTime + ((wi + 1) / words.length) * duration : s.EndTime;
            newSyllables.push({
              Text: w,
              StartTime: wStart,
              EndTime: wEnd,
              IsPartOfWord: wIsLast,
            });
          });
        } else {
          newSyllables.push(s);
        }
      }
      item = { ...item, Lead: { ...item.Lead, Syllables: newSyllables } };
    }

    if (typeof item.Text === "string" && (!item.Lead || !item.Lead.Syllables)) {
      const text = item.Text.trim();
      const startTime = item.StartTime ?? 0;
      const endTime = item.EndTime ?? startTime + 3;
      const words = $forceWordLevel.get() ? text.split(/\s+/).filter(Boolean) : [text];
      const duration = endTime > startTime ? endTime - startTime : 0;
      const syllables = words.map((w: string, wi: number) => ({
        Text: w,
        StartTime: duration > 0 ? startTime + (wi / words.length) * duration : startTime,
        EndTime: duration > 0 ? startTime + ((wi + 1) / words.length) * duration : endTime,
        IsPartOfWord: false,
      }));
      item = {
        ...item,
        Lead: {
          StartTime: startTime,
          EndTime: endTime,
          Syllables: syllables,
        },
      };
    }

    item = extractParenthesesBackgrounds(item);
    item = cleanBackgroundParens(item);
    return item;
  });

  const Type = data.Type === "Line" ? "Syllable" : data.Type;
  return { ...data, Type, Content };
}

function cleanBackgroundParens(item: any): any {
  if (!item) return item;

  if (Array.isArray(item.Background)) {
    const cleanedBg = item.Background.map((bgGroup: any) => {
      if (!bgGroup || !Array.isArray(bgGroup.Syllables)) return bgGroup;
      const cleanedSyllables = bgGroup.Syllables.map((s: any) => {
        if (!s || typeof s.Text !== "string") return s;
        const cleanText = s.Text.replace(/^\(/, "").replace(/\)$/, "").trim();
        return { ...s, Text: cleanText };
      }).filter((s: any) => s && s.Text && s.Text.length > 0);
      return { ...bgGroup, Syllables: cleanedSyllables };
    });
    item = { ...item, Background: cleanedBg };
  } else if (item.Background && Array.isArray(item.Background.Syllables)) {
    const cleanedSyllables = item.Background.Syllables.map((s: any) => {
      if (!s || typeof s.Text !== "string") return s;
      const cleanText = s.Text.replace(/^\(/, "").replace(/\)$/, "").trim();
      return { ...s, Text: cleanText };
    }).filter((s: any) => s && s.Text && s.Text.length > 0);
    item = { ...item, Background: { ...item.Background, Syllables: cleanedSyllables } };
  }

  return item;
}

function extractParenthesesBackgrounds(item: any): any {
  if (!item || !item.Lead || !Array.isArray(item.Lead.Syllables)) return item;

  const leadSyllables: any[] = [];
  const bgSyllables: any[] = [];

  let inParens = false;
  for (const s of item.Lead.Syllables) {
    if (!s || typeof s.Text !== "string") continue;
    const raw = s.Text.trim();
    if (raw.startsWith("(") || inParens) {
      inParens = true;
      const cleanText = raw.replace(/^[()]+|[()]+$/g, "");
      if (cleanText) {
        bgSyllables.push({ ...s, Text: cleanText });
      }
      if (raw.endsWith(")")) {
        inParens = false;
      }
    } else {
      leadSyllables.push(s);
    }
  }

  if (bgSyllables.length > 0 && leadSyllables.length > 0) {
    const bgGroup = {
      StartTime: bgSyllables[0].StartTime,
      EndTime: bgSyllables[bgSyllables.length - 1].EndTime,
      Syllables: bgSyllables,
      IsBackground: true,
    };
    const existingBg = Array.isArray(item.Background)
      ? item.Background
      : item.Background
      ? [item.Background]
      : [];
    return {
      ...item,
      Lead: { ...item.Lead, Syllables: leadSyllables },
      Background: [...existingBg, bgGroup],
    };
  }

  return item;
}

/**
 * Give Static payloads the `Lines` array upstream's applier requires.
 *
 * Every source in this app emits Spicy's `{ Type, Content }` shape, but
 * ApplyStaticLyrics (Static.ts:63) reads `data.Lines` and immediately calls
 * `.some(...)` on it. For an unsynced track — Apple serves these as
 * itunes:timing="None" — that threw:
 *
 *   TypeError: Cannot read properties of undefined (reading 'some')
 *
 * The damage outlived the track. ApplyLyrics runs DestroyAllLyricsContainers()
 * *before* it builds, so throwing partway left a detached container behind, and
 * every later apply died in its cleanup with "Failed to execute 'unobserve' on
 * 'ResizeObserver'". A single unsynced song blanked every song after it.
 */
function withStaticLines(data: SpicyLyrics): SpicyLyrics {
  if (data.Type !== "Static") return data;

  const Lines = ((data as any).Content ?? []).map((line: any) => {
    if (typeof line?.Text === "string") return { Text: line.Text };

    const syllables = line?.Lead?.Syllables ?? [];
    // IsPartOfWord marks a syllable that continues the previous word, so it
    // must not gain a leading space.
    const Text = syllables
      .map((s: any, i: number) => (i > 0 && !s?.IsPartOfWord ? " " : "") + (s?.Text ?? ""))
      .join("")
      .trim();
    return { Text };
  });

  return { ...data, Lines } as SpicyLyrics;
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
    return [withStaticLines(withArrayBackgrounds(withStartTime(expandSyllablesInLyrics(data)))), 200];
  }

  return ["unknown-error", 500];
}

import { $forceWordLevel } from "../../utils/stores.ts";

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
      forceWordLevel: $forceWordLevel.get(),
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
