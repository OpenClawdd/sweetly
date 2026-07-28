/**
 * Apple Music TTML (XML) -> spicylyrics {Content:[...]} JSON.
 *
 * Kept in its own module so it can be used by the custom-lyrics source and
 * exercised in tests without pulling in electron-store, which appleMusicApi.js
 * instantiates at import time.
 */
import { splitLineToSyllables } from "./utils.js";

export function parseTtmlXmlToJson(xml, opts = {}) {
  const parseTime = (ts) => {
    if (!ts) return 0;
    if (typeof ts === "number") return ts;
    const clean = String(ts)
      .replace(/s$/i, "")
      .replace(/^['"]+|['"]+$/g, "")
      .trim();
    if (!clean) return 0;
    const parts = clean.split(":");
    if (parts.length === 3) {
      return parseFloat(parts[0] || 0) * 3600 + parseFloat(parts[1] || 0) * 60 + parseFloat(parts[2] || 0);
    }
    if (parts.length === 2) {
      return parseFloat(parts[0] || 0) * 60 + parseFloat(parts[1] || 0);
    }
    return parseFloat(clean) || 0;
  };

  const cleanText = (raw) => {
    if (!raw) return "";
    return raw
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  };

  const cleanTextKeepTrailing = (raw) => {
    if (!raw) return { text: "", endsWithSpace: false };
    let text = raw
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ");
    const endsWithSpace = text.endsWith(" ");
    return { text: text.trim(), endsWithSpace };
  };

  /**
   * Pull nested background-vocal groups out of a <p>.
   *
   * Apple nests ad-libs inside the lead paragraph:
   *   <p>...<span ttm:role="x-bg"><span>Dead </span><span>fresh</span></span></p>
   * The flat span regex below walks straight through that nesting, which
   * appended the ad-lib onto the lead line ("...Carlton Dead fresh") instead
   * of giving it its own stacked sub-line the way Music.app does.
   *
   * Returns the lead content with the background groups removed, plus each
   * group's inner content, matched by counting <span> depth.
   */
  const extractBackgroundGroups = (pContent) => {
    const openTag = /<span\b([^>]*)>/gi;
    const groups = [];
    const leadParts = [];
    let cursor = 0;
    let m;

    while ((m = openTag.exec(pContent)) !== null) {
      if (!/(?:ttm:)?role\s*=\s*["'](?:x-bg|Background)["']/i.test(m[1])) continue;

      const innerStart = openTag.lastIndex;
      const scan = /<span\b[^>]*>|<\/span>/gi;
      scan.lastIndex = innerStart;
      let depth = 1;
      let innerEnd = -1;
      let groupEnd = -1;
      let s;
      while ((s = scan.exec(pContent)) !== null) {
        if (s[0][1] === "/") {
          if (--depth === 0) { innerEnd = s.index; groupEnd = scan.lastIndex; break; }
        } else {
          depth++;
        }
      }
      if (groupEnd === -1) continue;

      groups.push({ tag: m[0], content: pContent.slice(innerStart, innerEnd) });
      leadParts.push(pContent.slice(cursor, m.index));
      cursor = groupEnd;
      openTag.lastIndex = groupEnd;
    }

    leadParts.push(pContent.slice(cursor));
    return { leadContent: leadParts.join(" "), groups };
  };

  /** Flat span list -> Syllables, preserving inter-span whitespace as word breaks. */
  const parseSyllables = (content) => {
    const spanRegex = /<(?:span|sy)\b[^>]*>([\s\S]*?)<\/(?:span|sy)>/g;
    const spanMatches = [];
    let sm;
    while ((sm = spanRegex.exec(content)) !== null) {
      spanMatches.push({ fullTag: sm[0], content: sm[1], index: sm.index });
    }

    const syllables = [];
    for (let si = 0; si < spanMatches.length; si++) {
      const { fullTag, content: spanContent, index } = spanMatches[si];
      const { text: rawText, endsWithSpace } = cleanTextKeepTrailing(spanContent);
      if (!rawText) continue;

      const sBegin = (fullTag.match(/begin="([^"]+)"/) || [])[1];
      const sEnd = (fullTag.match(/end="([^"]+)"/) || [])[1];

      const isLast = si === spanMatches.length - 1;
      let spaceBetween = false;
      if (!isLast) {
        const between = content.slice(index + fullTag.length, spanMatches[si + 1].index);
        if (/\s/.test(between)) spaceBetween = true;
      }

      const isPartOfWord = !isLast && !endsWithSpace && !spaceBetween;

      const startTime = parseTime(sBegin || "0");
      const endTime = parseTime(sEnd || "0");

      if (/\s/.test(rawText)) {
        const words = rawText.split(/\s+/).filter(Boolean);
        const duration = endTime > startTime ? endTime - startTime : 0;
        words.forEach((w, wi) => {
          const wIsLast = isLast && wi === words.length - 1;
          const wIsPartOfWord = !wIsLast && (wi < words.length - 1 ? false : isPartOfWord);
          const wStart = duration > 0 ? startTime + (wi / words.length) * duration : startTime;
          const wEnd = duration > 0 ? startTime + ((wi + 1) / words.length) * duration : endTime;
          syllables.push({
            Text: w,
            StartTime: wStart,
            EndTime: wEnd,
            IsPartOfWord: wIsPartOfWord,
          });
        });
      } else {
        syllables.push({
          Text: rawText,
          StartTime: startTime,
          EndTime: endTime,
          IsPartOfWord: isPartOfWord,
        });
      }
    }
    return syllables;
  };

  const lines = [];

  const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
  let pm;
  while ((pm = pRegex.exec(xml)) !== null) {
    const pContent = pm[1];
    // Only the opening <p ...> tag — pm[0] spans the whole element, so testing
    // it made any paragraph *containing* an x-bg span read as fully background.
    const pTag = (pm[0].match(/^<p\b[^>]*>/) || [pm[0]])[0];
    const pBegin = (pTag.match(/begin="([^"]+)"/) || [])[1];
    const pEnd = (pTag.match(/end="([^"]+)"/) || [])[1];
    const pIsBackground = /(?:ttm:)?role="(?:Background|x-bg)"/i.test(pTag);
    const pIsOpposite = /(?:ttm:)?agent="v2"|role="x-opposite"|agent="v[2-9]"/i.test(pTag);

    const { leadContent, groups } = extractBackgroundGroups(pContent);

    const lead = {
      StartTime: parseTime(pBegin || "0"),
      EndTime: parseTime(pEnd || pBegin || "0"),
      Syllables: parseSyllables(leadContent),
      IsBackground: pIsBackground,
    };

    // Each x-bg group becomes its own stacked sub-line under the lead.
    let background = null;
    const rawBgSyllables = groups.flatMap((g) => parseSyllables(g.content));
    const bgSyllables = rawBgSyllables.map((s) => {
      if (s && typeof s.Text === "string") {
        const cleanText = s.Text.replace(/^\(/, "").replace(/\)$/, "").trim();
        return { ...s, Text: cleanText };
      }
      return s;
    }).filter((s) => s && s.Text && s.Text.length > 0);

    if (bgSyllables.length > 0) {
      background = {
        StartTime: bgSyllables[0].StartTime,
        EndTime: bgSyllables[bgSyllables.length - 1].EndTime,
        Syllables: bgSyllables,
        IsBackground: true,
      };
    }

    if (lead.Syllables.length > 0) {
      lines.push({ Lead: lead, Background: background, OppositeAligned: pIsOpposite });
    } else if (background) {
      // Background-only paragraph — promote it so the line still renders.
      lines.push({ Lead: background, OppositeAligned: pIsOpposite });
    } else {
      const plainText = cleanText(pContent);
      if (plainText) {
        // A line-level <p> has no <span> children, so upstream's per-word
        // animation has nothing to attach to and the line renders as one smeared
        // gradient. Split it so every word gets an element. These timings are
        // interpolated — a fallback for tracks with no real alignment.
        const splitWords = opts.forceWordLevel !== false; // default true
        let syllables = [];
        if (splitWords) {
          syllables = splitLineToSyllables(plainText, lead.StartTime, lead.EndTime);
        }
        lines.push({
          Lead: {
            StartTime: lead.StartTime,
            EndTime: lead.EndTime,
            Syllables: syllables.length
              ? syllables
              : [{ Text: plainText, StartTime: lead.StartTime, EndTime: lead.EndTime, IsPartOfWord: false }],
          },
          OppositeAligned: false,
        });
      }
    }
  }

  if (lines.length > 0) {
    // itunes:timing="None" means Apple only has unsynced plain text — no
    // spans, no begin/end anywhere. Every line then lands at startTime 0, so
    // the active-line search resolves to the last line and the view sits at
    // the bottom of the song forever. Flag it so callers can prefer a real
    // synced source and the renderer can show it as static text.
    // fetchLyrics strips namespace prefixes, so this may arrive as either
    // `itunes:timing=` or bare `timing=`.
    const declaredTiming = (xml.match(/(?:itunes:)?timing="([^"]+)"/i) || [])[1] || "";
    const hasAnyTimestamp = lines.some(
      (l) => (l.Lead?.EndTime || 0) > 0 || l.Lead?.Syllables?.some((s) => s.EndTime > 0),
    );
    const isSynced = declaredTiming.toLowerCase() !== "none" && hasAnyTimestamp;

    console.log(
      "[AppleMusicAPI] Parsed TTML:", lines.length, "lines",
      `timing="${declaredTiming || "unset"}"`, isSynced ? "" : "(UNSYNCED)",
    );
    return { Content: lines, Type: isSynced ? "Syllable" : "Static", Unsynced: !isSynced };
  }

  return null;
}
