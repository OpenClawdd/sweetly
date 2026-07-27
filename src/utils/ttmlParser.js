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

    // Clause & Inline Parenthetical Parser
    let currentMain = [];
    let currentBg = [];
    let inParen = false;

    for (const w of line.words) {
      const txt = w.text ? w.text.trim() : "";
      if (IS_SECTION_TAG.test(txt)) {
        currentMain.push(w);
        continue;
      }

      const hasOpen = txt.includes("(");
      const hasClose = txt.includes(")");

      if (hasOpen || inParen) {
        inParen = !hasClose;
        const cleanTxt = txt.replace(/[\(\)]/g, "").replace(/^[\,\.\?\!\:\;]+|[\,\.\?\!\:\;]+$/g, "").trim();
        if (cleanTxt && !IS_SECTION_TAG.test(cleanTxt)) {
          currentBg.push({ ...w, text: cleanTxt });
        }
        if (!inParen && currentBg.length > 0) {
          // Flush current main phrase and bg phrase
          if (currentMain.length > 0) {
            splitRawLines.push({
              ...line,
              words: [...currentMain],
              startTime: currentMain[0].startTime,
              endTime: currentMain[currentMain.length - 1].endTime,
              isBackground: false,
            });
            currentMain = [];
          }
          splitRawLines.push({
            ...line,
            words: [...currentBg],
            startTime: currentBg[0].startTime,
            endTime: currentBg[currentBg.length - 1].endTime,
            isBackground: true,
          });
          currentBg = [];
        }
      } else {
        currentMain.push(w);
      }
    }

    if (currentMain.length > 0) {
      const mainWords = [...currentMain];
      const bgWords = [];
      const INTERJECTIONS = /^(boom[-]?boom|slop|slap|skrrt|yeah|yea|uh|uh-huh|woah|whoa|ay|aye|brrr|brrt|pew|pop|bitch|gang|bop|ha|haha|flex|blat|slatt|yah|yup|oh|no|wait|look|say|hol'?\s*up|hold\s*up|go)$/i;

      // Detect mid-line ad-libs or capitalized interjections after main phrase
      if (mainWords.length >= 3) {
        let splitIdx = -1;
        for (let k = 1; k < mainWords.length - 1; k++) {
          const prevTxt = mainWords[k].text ? mainWords[k].text.trim() : "";
          const nextRaw = mainWords[k + 1].text ? mainWords[k + 1].text.trim() : "";
          const nextClean = nextRaw.replace(/[\(\)\,\.\?!]/g, "");

          if (/[\?!]$/.test(prevTxt) && nextRaw) {
            splitIdx = k + 1;
            break;
          }
          if (INTERJECTIONS.test(nextClean)) {
            splitIdx = k + 1;
            break;
          }
          if (k >= 2 && /^[A-Z][a-z]/.test(nextClean) && !/^(I|I'm|I've|I'll|I'd|A|The|And|But|So|Or|My|Your|Our)$/.test(nextClean)) {
            splitIdx = k + 1;
            break;
          }
        }

        if (splitIdx > 0 && splitIdx < mainWords.length) {
          const adlibPart = mainWords.splice(splitIdx);
          for (const w of adlibPart) {
            const cleanTxt = w.text ? w.text.replace(/[\(\)]/g, "").trim() : "";
            if (cleanTxt) {
              bgWords.push({ ...w, text: cleanTxt });
            }
          }
        }
      }

      splitRawLines.push({
        ...line,
        words: mainWords,
        startTime: mainWords[0].startTime,
        endTime: mainWords[mainWords.length - 1].endTime,
        isBackground: false,
      });

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
    const rawTxt = syl.Text || "";

    if (rawTxt.includes(" ")) {
      if (currentWord) {
        finalizeWord(currentWord);
        words.push(currentWord);
        currentWord = null;
      }
      const parts = rawTxt.split(/\s+/).filter(Boolean);
      const start = syl.StartTime ?? 0;
      const end = syl.EndTime ?? start;
      const totalLen = rawTxt.length || 1;
      let cur = start;

      for (let p = 0; p < parts.length; p++) {
        const partText = parts[p];
        const partDur = (end - start) * (partText.length / totalLen);
        words.push({
          text: partText,
          startTime: cur,
          endTime: cur + partDur,
          isPartOfWord: false,
          isLetterGroup: false,
        });
        cur += partDur;
      }
      continue;
    }

    if (!currentWord) {
      currentWord = {
        text: rawTxt,
        startTime: syl.StartTime ?? 0,
        endTime: syl.EndTime ?? 0,
        isPartOfWord: syl.IsPartOfWord === true,
      };
    } else {
      currentWord.text += rawTxt;
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

