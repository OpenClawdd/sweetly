/**
 * Parses spicylyrics.org API response format (TTML-based syllable data)
 * into word-level structures with letter splitting and instrumental dot lines.
 */

export function parseTTMLData(apiResponse, provider = "apple") {
  if (!apiResponse || !apiResponse.Content) return { lines: [], type: "none", provider };

  const type = apiResponse.Type || "Unknown";
  const rawLines = [];

  for (const contentLine of apiResponse.Content) {
    const lead = contentLine.Lead;
    if (lead && lead.Syllables && lead.Syllables.length > 0) {
      const words = groupSyllablesIntoWords(lead.Syllables);
      if (words.length > 0) {
        rawLines.push({
          words,
          startTime: lead.StartTime ?? contentLine.StartTime ?? 0,
          endTime: lead.EndTime ?? contentLine.EndTime ?? 0,
          oppositeAligned: contentLine.OppositeAligned === true,
          isBackground: lead.IsBackground === true,
        });
      }
    }

    const bg = contentLine.Background;
    if (bg && bg !== lead && bg.Syllables && bg.Syllables.length > 0) {
      const words = groupSyllablesIntoWords(bg.Syllables);
      if (words.length > 0) {
        rawLines.push({
          words,
          startTime: bg.StartTime ?? contentLine.StartTime ?? 0,
          endTime: bg.EndTime ?? contentLine.EndTime ?? 0,
          oppositeAligned: contentLine.OppositeAligned === true,
          isBackground: true,
        });
      }
    }
  }

  const IS_SECTION_TAG = /^\(?\[?(intro|outro|chorus|verse|bridge|refrain|hook|pre-chorus|post-chorus|instrumental|interlude|solo|breakdown|spoken)/i;

  // Clean parenthetical background vocal splitting and parenthesis stripping
  const splitRawLines = [];
  for (const line of rawLines) {
    if (!line.words || line.words.length === 0) continue;

    if (line.isBackground) {
      const cleanWords = line.words.map((w) => ({
        ...w,
        text: w.text ? w.text.replace(/^\(/, "").replace(/\)$/, "").replace(/\s*[\(\)]\s*/g, " ").trim() : "",
      })).filter((w) => w.text.length > 0 && !IS_SECTION_TAG.test(w.text));

      if (cleanWords.length > 0) {
        splitRawLines.push({ ...line, words: cleanWords });
      }
      continue;
    }

    const mainWords = [];
    const bgWords = [];
    let inParen = false;

    for (const w of line.words) {
      const txt = w.text ? w.text.trim() : "";
      if (IS_SECTION_TAG.test(txt)) {
        mainWords.push(w);
        continue;
      }
      if (txt.startsWith("(") || inParen) {
        inParen = true;
        const cleanTxt = txt.replace(/^\(/, "").replace(/\)$/, "").trim();
        if (cleanTxt && !IS_SECTION_TAG.test(cleanTxt)) {
          bgWords.push({ ...w, text: cleanTxt });
        } else if (cleanTxt) {
          mainWords.push(w);
        }
        if (txt.endsWith(")")) {
          inParen = false;
        }
      } else {
        mainWords.push(w);
      }
    }

    const ADLIB_WORDS = /^(boom[-]?boom|slop|slap|skrrt|yeah|uh|uh-huh|woah|ay|aye|brrr|brrt|pew|pop|bitch|gang|bop|ha|haha|whoa|flex|blat|slatt|yah|yup)$/i;

    // Detect trailing ad-libs after terminal punctuation (?, !) or sound words (e.g. "What I gotta do to show you wrong? Boom-boom")
    if (mainWords.length > 1 && bgWords.length === 0) {
      let splitIdx = -1;
      for (let k = 0; k < mainWords.length - 1; k++) {
        const prevTxt = mainWords[k].text ? mainWords[k].text.trim() : "";
        const nextTxt = mainWords[k + 1].text ? mainWords[k + 1].text.trim() : "";

        if (/[\?!]$/.test(prevTxt) && nextTxt) {
          splitIdx = k + 1;
          break;
        }
        if (k > 0 && ADLIB_WORDS.test(nextTxt.replace(/[\(\)\,\.\?!]/g, ""))) {
          splitIdx = k + 1;
          break;
        }
      }

      if (splitIdx > 0 && splitIdx < mainWords.length) {
        const adlibPart = mainWords.splice(splitIdx);
        for (const w of adlibPart) {
          const cleanTxt = w.text ? w.text.replace(/^\(/, "").replace(/\)$/, "").trim() : "";
          if (cleanTxt) {
            bgWords.push({ ...w, text: cleanTxt });
          }
        }
      }
    }

    if (mainWords.length > 0) {
      splitRawLines.push({
        ...line,
        words: mainWords,
        endTime: mainWords[mainWords.length - 1].endTime,
      });
    }

    if (bgWords.length > 0) {
      splitRawLines.push({
        ...line,
        words: bgWords,
        startTime: bgWords[0].startTime,
        endTime: bgWords[bgWords.length - 1].endTime,
        isBackground: true,
      });
    }
  }

  // Insert instrumental gap dot lines for gaps >= 3.0 seconds
  const lines = [];
  for (let i = 0; i < splitRawLines.length; i++) {
    const line = splitRawLines[i];
    if (i > 0) {
      const prevEnd = splitRawLines[i - 1].endTime;
      const currStart = line.startTime;
      if (prevEnd != null && currStart - prevEnd >= 3.0) {
        const gapStart = prevEnd;
        const gapEnd = currStart;
        const availableDur = Math.max(0.5, (gapEnd - 0.5) - gapStart);
        const dotDur = availableDur / 3;

        const dots = [0, 1, 2].map((idx) => ({
          text: "•",
          startTime: gapStart + idx * dotDur,
          endTime: gapStart + (idx + 1) * dotDur,
          isDot: true,
        }));

        lines.push({
          isDotLine: true,
          words: dots,
          dots,
          startTime: gapStart,
          endTime: gapEnd,
          isBackground: false,
        });
      }
    }
    if (line.words) {
      ensureWordLevelTimings(line);
    }
    lines.push(line);
  }

  return { lines, type, provider };
}

function ensureWordLevelTimings(line) {
  if (!line || !line.words || line.words.length === 0) return;
  const lineStart = line.startTime ?? 0;
  const lineEnd = line.endTime ?? (lineStart + 3);
  const dur = lineEnd - lineStart;
  if (dur <= 0) return;

  const hasDistinct = line.words.some((w) => w.startTime != null && w.endTime != null && w.startTime > lineStart + 0.05);
  if (hasDistinct && line.words.length > 1) return;

  const totalChars = line.words.reduce((sum, w) => sum + (w.text ? w.text.length : 1), 0);
  let curTime = lineStart;

  for (let i = 0; i < line.words.length; i++) {
    const w = line.words[i];
    const len = w.text ? w.text.length : 1;
    const wordDur = Math.max(0.08, (dur * len) / (totalChars || 1));
    w.startTime = curTime;
    w.endTime = curTime + wordDur;
    curTime += wordDur;
  }
}

function groupSyllablesIntoWords(syllables) {
  if (!syllables || syllables.length === 0) return [];

  const words = [];
  let currentWord = null;

  for (const syl of syllables) {
    if (!currentWord) {
      currentWord = {
        text: syl.Text || "",
        startTime: syl.StartTime ?? 0,
        endTime: syl.EndTime ?? 0,
        isPartOfWord: syl.IsPartOfWord === true,
      };
    } else {
      currentWord.text += syl.Text || "";
      currentWord.endTime = syl.EndTime ?? currentWord.endTime;
      currentWord.isPartOfWord = true;
    }

    if (syl.IsPartOfWord !== true) {
      finalizeWord(currentWord);
      words.push(currentWord);
      currentWord = null;
    }
  }

  if (currentWord) {
    finalizeWord(currentWord);
    words.push(currentWord);
  }

  return words;
}

function finalizeWord(word) {
  if (!word || !word.text) return;
  word.isLetterGroup = false;
}

export function getActiveIndices(lines, currentTimeSeconds) {
  if (!lines || lines.length === 0) return { line: -1, word: -1 };

  let activeLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (currentTimeSeconds >= lines[i].startTime) {
      activeLine = i;
    } else {
      break;
    }
  }

  if (activeLine === -1) return { line: -1, word: -1 };

  const line = lines[activeLine];
  let activeWord = -1;
  const words = line.isDotLine ? line.dots : line.words;

  if (words) {
    for (let j = 0; j < words.length; j++) {
      if (currentTimeSeconds >= words[j].startTime) {
        activeWord = j;
      } else {
        break;
      }
    }
  }

  return { line: activeLine, word: activeWord };
}

