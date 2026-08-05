import { getMusicState, onMusicStateChange } from "../adapter/musicState.ts";

const STYLE_ID = "sweetly-semantic-lyrics-style";
const TITLE_CLASS = "SweetlyTitleMoment";
const ACTIVE_TITLE_CLASS = "SweetlyTitleMomentActive";
const HOOK_CLASS = "SweetlyHookMoment";
const ADLIB_CLASS = "SweetlyAdlibMoment";
const PAGE_ACTIVE_CLASS = "SweetlyTitlePulseActive";

function normalise(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleVariants(value: string): string[] {
  const full = normalise(value);
  if (!full) return [];

  const withoutVersion = normalise(
    value.replace(/\s*[-–—]\s*(remaster(?:ed)?|radio edit|live|deluxe|explicit|clean|version).*$/i, "")
  );

  return [...new Set([full, withoutVersion].filter((variant) => variant.length >= 3))];
}

function lineText(element: Element): string {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

function isTitleMatch(text: string, variants: string[]): boolean {
  if (!text) return false;

  for (const title of variants) {
    if (text.includes(title)) return true;

    const words = title.split(" ").filter((word) => word.length > 1);
    if (words.length > 1 && words.every((word) => text.split(" ").includes(word))) return true;
  }

  return false;
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
      transform-origin: 18% 50%;
      transition:
        filter 360ms cubic-bezier(.2,.8,.2,1),
        transform 500ms cubic-bezier(.2,.9,.2,1);
    }

    .${TITLE_CLASS}::after {
      content: "";
      position: absolute;
      inset: -22% -4%;
      z-index: -1;
      pointer-events: none;
      border-radius: 999px;
      opacity: var(--sweetly-title-strength);
      transform: scale(.92);
      background: radial-gradient(
        ellipse at 24% 50%,
        color-mix(in srgb, currentColor 28%, transparent),
        transparent 70%
      );
      filter: blur(20px);
      transition:
        opacity 480ms ease,
        transform 620ms cubic-bezier(.2,.9,.2,1);
    }

    .${TITLE_CLASS}.${ACTIVE_TITLE_CLASS} {
      --sweetly-title-strength: .78;
      transform: scale(1.026) translateX(2px);
      filter: saturate(1.14) brightness(1.08) drop-shadow(0 0 16px color-mix(in srgb, currentColor 22%, transparent));
    }

    .${TITLE_CLASS}.${ACTIVE_TITLE_CLASS}::after {
      transform: scale(1.06);
    }

    .${HOOK_CLASS}:not(.${ACTIVE_TITLE_CLASS}) {
      letter-spacing: .002em;
    }

    .${HOOK_CLASS}.Active {
      filter: saturate(1.06) brightness(1.025);
    }

    .${ADLIB_CLASS} {
      opacity: .86;
      font-size: .91em;
      font-style: italic;
    }

    body.${PAGE_ACTIVE_CLASS} #SpicyLyricsPage .ContentBox {
      filter: saturate(1.035) brightness(1.018);
      transition: filter 520ms cubic-bezier(.2,.8,.2,1);
    }

    @media (prefers-reduced-motion: reduce) {
      .${TITLE_CLASS},
      .${TITLE_CLASS}::after,
      body.${PAGE_ACTIVE_CLASS} #SpicyLyricsPage .ContentBox {
        transition: none !important;
        transform: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function markSemanticLines(): void {
  const lines = [...document.querySelectorAll<HTMLElement>(".LyricsContent .line")];
  const variants = titleVariants(getMusicState().track?.nameCleaned || "");
  const counts = new Map<string, number>();

  for (const line of lines) {
    const text = normalise(lineText(line));
    if (text.length >= 3) counts.set(text, (counts.get(text) || 0) + 1);
  }

  let titleMomentActive = false;

  for (const line of lines) {
    const rawText = lineText(line);
    const text = normalise(rawText);
    const title = isTitleMatch(text, variants);
    const hook = text.length >= 3 && (counts.get(text) || 0) >= 2;
    const adlib = /^\s*[([][^\])]+[)\]]\s*$/.test(rawText);
    const active = line.classList.contains("Active");

    line.classList.toggle(TITLE_CLASS, title);
    line.classList.toggle(ACTIVE_TITLE_CLASS, title && active);
    line.classList.toggle(HOOK_CLASS, hook);
    line.classList.toggle(ADLIB_CLASS, adlib);

    const roles = [title && "title", hook && "hook", adlib && "adlib"].filter(Boolean);
    if (roles.length) line.dataset.sweetlyRole = roles.join(" ");
    else delete line.dataset.sweetlyRole;

    if (title && active) titleMomentActive = true;
  }

  document.body.classList.toggle(PAGE_ACTIVE_CLASS, titleMomentActive);
}

let scheduled = false;
function scheduleMark(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    markSemanticLines();
  });
}

export function installTitleMoments(): void {
  installStyle();

  const observer = new MutationObserver(scheduleMark);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  onMusicStateChange(scheduleMark);
  scheduleMark();
}

installTitleMoments();
