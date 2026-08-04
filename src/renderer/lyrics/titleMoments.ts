import { getMusicState, onMusicStateChange } from "../adapter/musicState.ts";

const STYLE_ID = "sweetly-title-moments-style";
const TITLE_CLASS = "SweetlyTitleMoment";
const ACTIVE_CLASS = "SweetlyTitleMomentActive";

function normalise(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lineText(element: Element): string {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

function installStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${TITLE_CLASS} {
      --sweetly-title-strength: 0;
      position: relative;
      isolation: isolate;
      transition: filter 420ms cubic-bezier(.2,.8,.2,1), transform 520ms cubic-bezier(.2,.9,.2,1);
    }
    .${TITLE_CLASS}::after {
      content: "";
      position: absolute;
      inset: -18% -3%;
      z-index: -1;
      pointer-events: none;
      border-radius: 999px;
      opacity: var(--sweetly-title-strength);
      transform: scale(.94);
      background: radial-gradient(ellipse at center, color-mix(in srgb, currentColor 22%, transparent), transparent 68%);
      filter: blur(18px);
      transition: opacity 520ms ease, transform 620ms cubic-bezier(.2,.9,.2,1);
    }
    .${TITLE_CLASS}.${ACTIVE_CLASS} {
      --sweetly-title-strength: .72;
      transform: scale(1.018);
      filter: saturate(1.08) brightness(1.05);
    }
    .${TITLE_CLASS}.${ACTIVE_CLASS}::after { transform: scale(1.04); }
    @media (prefers-reduced-motion: reduce) {
      .${TITLE_CLASS}, .${TITLE_CLASS}::after { transition: none !important; transform: none !important; }
    }
  `;
  document.head.appendChild(style);
}

function markTitleLines(): void {
  const title = normalise(getMusicState().track?.nameCleaned || "");
  const titleWords = title.split(" ").filter((word) => word.length > 1);
  const canMatch = title.length >= 3 && titleWords.length > 0;

  for (const line of document.querySelectorAll<HTMLElement>(".LyricsContent .line")) {
    const text = normalise(lineText(line));
    const exactPhrase = canMatch && text.includes(title);
    const wordCoverage = canMatch && titleWords.length > 1 && titleWords.every((word) => text.includes(word));
    line.classList.toggle(TITLE_CLASS, Boolean(exactPhrase || wordCoverage));
    line.classList.toggle(ACTIVE_CLASS, line.classList.contains(TITLE_CLASS) && line.classList.contains("Active"));
  }
}

let scheduled = false;
function scheduleMark(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    markTitleLines();
  });
}

export function installTitleMoments(): void {
  installStyle();
  const observer = new MutationObserver(scheduleMark);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  onMusicStateChange(scheduleMark);
  scheduleMark();
}

installTitleMoments();
