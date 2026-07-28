/**
 * Converts locally-sourced TTML into the shapes Spicy's applyers consume.
 *
 * Deliberately local: upstream's utils/Lyrics/manager/parseTTML.ts posts the
 * document to Spicy's hosted API. Custom files and aligner output are ours and
 * have no business leaving this machine to be parsed.
 *
 * All emitted times are MILLISECONDS, matching what the applyers expect.
 */

export type Syllable = {
  Text: string;
  StartTime: number;
  EndTime: number;
  IsPartOfWord?: boolean;
  TransliteratedText?: string;
};

export type VocalGroup = {
  StartTime: number;
  EndTime: number;
  Syllables: Syllable[];
};

export type SyllableLyrics = {
  Type: "Syllable";
  StartTime: number;
  Content: Array<{
    Lead: VocalGroup;
    Background?: VocalGroup[];
    OppositeAligned?: boolean;
  }>;
};

export type LineLyrics = {
  Type: "Line";
  StartTime: number;
  Content: Array<{
    Text: string;
    StartTime: number;
    EndTime: number;
    OppositeAligned?: boolean;
  }>;
};

export type StaticLyrics = {
  Type: "Static";
  Lines: Array<{ Text: string }>;
};

export type SpicyLyrics = SyllableLyrics | LineLyrics | StaticLyrics;

/** `hh:mm:ss.SSS`, `mm:ss.SSS` or `ss.SSS` to milliseconds. */
export function parseTTMLTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parts = value.trim().split(":");
  if (parts.length > 3) return 0;
  if (parts.some((part) => part === "" || Number.isNaN(Number(part)))) return 0;

  let seconds = 0;
  if (parts.length === 3) {
    seconds = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  } else if (parts.length === 2) {
    seconds = Number(parts[0]) * 60 + Number(parts[1]);
  } else {
    seconds = Number(parts[0]);
  }

  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

const TTM_NS = "http://www.w3.org/ns/ttml#metadata";

function isBackground(span: Element): boolean {
  return (
    span.getAttribute("ttm:role") === "x-bg" ||
    span.getAttributeNS(TTM_NS, "role") === "x-bg"
  );
}

function isOpposite(p: Element): boolean {
  const agent = p.getAttribute("ttm:agent") || p.getAttributeNS(TTM_NS, "agent") || p.getAttribute("agent") || "";
  const role = p.getAttribute("ttm:role") || p.getAttributeNS(TTM_NS, "role") || p.getAttribute("role") || "";
  return agent === "v2" || role === "x-opposite" || /v[2-9]/.test(agent);
}

/**
 * A syllable continues the previous word when no whitespace separates them.
 * Apple encodes that space inside the span text, so trailing whitespace on
 * span N means span N+1 begins a new word.
 */
function collectSyllables(container: Element): Syllable[] {
  const spans = Array.from(container.children).filter(
    (child) => child.tagName.toLowerCase() === "span" && !isBackground(child),
  );

  return spans
    .flatMap((span, index) => {
      const raw = span.textContent ?? "";
      const isLast = index === spans.length - 1;
      const endsWithSpace = /\s$/.test(raw);

      let spaceBetween = false;
      if (!isLast) {
        const nextSpan = spans[index + 1];
        let sibling = span.nextSibling;
        while (sibling && sibling !== nextSpan) {
          if (sibling.textContent && /\s/.test(sibling.textContent)) {
            spaceBetween = true;
            break;
          }
          sibling = sibling.nextSibling;
        }
      }

      const isPartOfWord = !isLast && !endsWithSpace && !spaceBetween;
      const startTime = parseTTMLTime(span.getAttribute("begin"));
      const endTime = parseTTMLTime(span.getAttribute("end"));
      const trimmed = raw.trim();

      if (/\s/.test(trimmed)) {
        const words = trimmed.split(/\s+/).filter(Boolean);
        const duration = endTime > startTime ? endTime - startTime : 0;
        return words.map((w, wi) => {
          const wIsLast = isLast && wi === words.length - 1;
          const wIsPartOfWord = !wIsLast && (wi < words.length - 1 ? false : isPartOfWord);
          const wStart = duration > 0 ? startTime + Math.round((wi / words.length) * duration) : startTime;
          const wEnd = duration > 0 ? startTime + Math.round(((wi + 1) / words.length) * duration) : endTime;
          return {
            Text: w,
            StartTime: wStart,
            EndTime: wEnd,
            IsPartOfWord: wIsPartOfWord,
          };
        });
      }

      return [
        {
          Text: trimmed,
          StartTime: startTime,
          EndTime: endTime,
          IsPartOfWord: isPartOfWord,
        },
      ];
    })
    .filter((syllable) => syllable.Text.length > 0);
}

export function parseLocalTTML(ttml: string): SpicyLyrics | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(ttml, "application/xml");
  } catch {
    return null;
  }
  if (doc.querySelector("parsererror")) return null;

  const paragraphs = Array.from(doc.getElementsByTagName("p"));
  if (paragraphs.length === 0) return null;

  const hasTimedSpans = paragraphs.some((p) =>
    Array.from(p.getElementsByTagName("span")).some((span) => span.hasAttribute("begin")),
  );

  if (hasTimedSpans) {
    const content: SyllableLyrics["Content"] = [];

    for (const p of paragraphs) {
      const lead = collectSyllables(p);
      if (lead.length === 0) continue;

      const background = Array.from(p.children)
        .filter((child) => child.tagName.toLowerCase() === "span" && isBackground(child))
        .map((group) => ({
          StartTime: parseTTMLTime(group.getAttribute("begin")),
          EndTime: parseTTMLTime(group.getAttribute("end")),
          Syllables: collectSyllables(group),
        }))
        .filter((group) => group.Syllables.length > 0);

      const entry: SyllableLyrics["Content"][number] = {
        Lead: {
          StartTime: parseTTMLTime(p.getAttribute("begin")) || lead[0].StartTime,
          EndTime: parseTTMLTime(p.getAttribute("end")) || lead[lead.length - 1].EndTime,
          Syllables: lead,
        },
        OppositeAligned: isOpposite(p),
      };
      if (background.length > 0) entry.Background = background;
      content.push(entry);
    }

    if (content.length === 0) return null;
    return { Type: "Syllable", StartTime: content[0].Lead.StartTime, Content: content };
  }

  if (paragraphs.some((p) => p.hasAttribute("begin"))) {
    const content = paragraphs
      .map((p) => ({
        Text: (p.textContent ?? "").trim(),
        StartTime: parseTTMLTime(p.getAttribute("begin")),
        EndTime: parseTTMLTime(p.getAttribute("end")),
      }))
      .filter((line) => line.Text.length > 0);

    if (content.length === 0) return null;
    return { Type: "Line", StartTime: content[0].StartTime, Content: content };
  }

  const lines = paragraphs
    .map((p) => ({ Text: (p.textContent ?? "").trim() }))
    .filter((line) => line.Text.length > 0);

  if (lines.length === 0) return null;
  return { Type: "Static", Lines: lines };
}
