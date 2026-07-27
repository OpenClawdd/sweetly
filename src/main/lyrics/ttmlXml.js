/**
 * Apple Music TTML (XML) -> spicylyrics {Content:[...]} JSON.
 *
 * Kept in its own module so it can be used by the custom-lyrics source and
 * exercised in tests without pulling in electron-store, which appleMusicApi.js
 * instantiates at import time.
 */
export function parseTtmlXmlToJson(xml) {
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

      syllables.push({
        Text: rawText,
        StartTime: parseTime(sBegin || "0"),
        EndTime: parseTime(sEnd || "0"),
        IsPartOfWord: !endsWithSpace,
      });

      if (si < spanMatches.length - 1) {
        const between = content.slice(index + fullTag.length, spanMatches[si + 1].index);
        if (/\s/.test(between)) syllables[syllables.length - 1].IsPartOfWord = false;
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
    const pIsBackground = /(?:ttm:)?role="(?:Background|x-bg)"|agent="v(?:[2-9]|1[0-9])"/i.test(pTag);

    const { leadContent, groups } = extractBackgroundGroups(pContent);

    const lead = {
      StartTime: parseTime(pBegin || "0"),
      EndTime: parseTime(pEnd || pBegin || "0"),
      Syllables: parseSyllables(leadContent),
      IsBackground: pIsBackground,
    };

    // Each x-bg group becomes its own stacked sub-line under the lead.
    let background = null;
    const bgSyllables = groups.flatMap((g) => parseSyllables(g.content));
    if (bgSyllables.length > 0) {
      background = {
        StartTime: bgSyllables[0].StartTime,
        EndTime: bgSyllables[bgSyllables.length - 1].EndTime,
        Syllables: bgSyllables,
        IsBackground: true,
      };
    }

    if (lead.Syllables.length > 0) {
      lines.push({ Lead: lead, Background: background, OppositeAligned: false });
    } else if (background) {
      // Background-only paragraph — promote it so the line still renders.
      lines.push({ Lead: background, OppositeAligned: false });
    } else {
      const plainText = cleanText(pContent);
      if (plainText) {
        lines.push({ Lead: { StartTime: lead.StartTime, EndTime: lead.EndTime, Syllables: [{ Text: plainText, StartTime: lead.StartTime, EndTime: lead.EndTime, IsPartOfWord: false }] }, OppositeAligned: false });
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
