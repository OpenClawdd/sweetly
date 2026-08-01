import { SEARCH_UA, parseTTMLTime } from "../utils.js";
import { saveCustomLyrics } from "./custom.js";

export async function fetchBiniLyrics(name, artist) {
  try {
    const q = encodeURIComponent(`${name} ${artist}`);
    const res = await fetch(`https://lyrics-api.binimum.org/search?q=${q}`, {
      headers: { "User-Agent": SEARCH_UA, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data?.results;
    if (!results?.length) return null;

    const wordMatch = results.find((r) => r.timing_type === "word");
    if (!wordMatch?.lyricsUrl) return null;

    console.log(
      "[Sweetly-Main] BiniLyrics:",
      wordMatch.track_name,
      wordMatch.artist_name,
      wordMatch.timing_type
    );
    const ttmlRes = await fetch(wordMatch.lyricsUrl, {
      headers: { "User-Agent": SEARCH_UA },
    });
    if (!ttmlRes.ok) return null;
    const ttml = await ttmlRes.text();

    // Cache the downloaded word-level community TTML to disk
    saveCustomLyrics(name, artist, ttml);

    const cleanTtml = ttml.replace(/\b[a-z]+(?=:)/g, "");

    const lines = [];
    const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
    let pm;
    while ((pm = pRegex.exec(cleanTtml)) !== null) {
      const pTag = pm[0];
      const pContent = pm[1];
      const pBegin = (pTag.match(/begin="([^"]+)"/) || [])[1];
      const pEnd = (pTag.match(/end="([^"]+)"/) || [])[1];
      const lead = {
        StartTime: parseTTMLTime(pBegin || "0"),
        EndTime: parseTTMLTime(pEnd || pBegin || "0"),
        Syllables: [],
        IsBackground: /(?:ttm:)?role="(?:Background|x-bg)"|agent="v(?:[2-9]|1[0-9])"/i.test(pTag),
      };

      const spanRegex = /<(?:span|sy)\b[^>]*>([\s\S]*?)<\/(?:span|sy)>/g;
      const spanMatches = [];
      let sm;
      while ((sm = spanRegex.exec(pContent)) !== null) {
        spanMatches.push({ fullTag: sm[0], content: sm[1], index: sm.index });
      }
      for (let si = 0; si < spanMatches.length; si++) {
        const { fullTag, content, index } = spanMatches[si];
        const rawText = content.replace(/<[^>]+>/g, "");
        const hasTrailing = /\s$/.test(rawText);
        const text = rawText.trim();
        const sBegin = (fullTag.match(/begin="([^"]+)"/) || [])[1];
        const sEnd = (fullTag.match(/end="([^"]+)"/) || [])[1];
        const isLast = si === spanMatches.length - 1;

        let spaceBetween = false;
        if (!isLast) {
          const nextIndex = spanMatches[si + 1].index;
          const between = pContent.slice(index + fullTag.length, nextIndex);
          if (/\s/.test(between)) spaceBetween = true;
        }

        const isPartOfWord = !isLast && !hasTrailing && !spaceBetween;

        if (text) {
          lead.Syllables.push({
            Text: text,
            StartTime: parseTTMLTime(sBegin || "0"),
            EndTime: parseTTMLTime(sEnd || "0"),
            IsPartOfWord: isPartOfWord,
          });
        }
      }

      if (lead.Syllables.length > 0) {
        lines.push({ Lead: lead, OppositeAligned: false });
      } else {
        const plainText = pContent.replace(/<[^>]+>/g, "").trim();
        if (plainText) {
          lines.push({
            Lead: {
              StartTime: lead.StartTime,
              EndTime: lead.EndTime,
              Syllables: [
                {
                  Text: plainText,
                  StartTime: lead.StartTime,
                  EndTime: lead.EndTime,
                  IsPartOfWord: false,
                },
              ],
            },
            OppositeAligned: false,
          });
        }
      }
    }
    return lines.length > 0 ? { Content: lines, Type: "Syllable" } : null;
  } catch (e) {
    console.log("[Sweetly-Main] BiniLyrics error:", e.message);
    return null;
  }
}
