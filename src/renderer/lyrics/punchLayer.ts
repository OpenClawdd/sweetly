/**
 * Per-line motion for the lyrics view.
 *
 * Upstream ships this capability commented out (`applyScale` in
 * LyricsAnimator.ts), so no line has ever scaled. Rather than revive that code
 * — it assigns 0 to the active line, which would collapse it — this watches
 * class transitions and writes its own custom properties.
 *
 * Everything is a CSS custom property so the stylesheet owns the easing and a
 * reduced-motion user gets a static view for free.
 */

const PAGE_SELECTOR = "#SpicyLyricsPage";
const ACTIVE_SCALE = 1.045;
const REST_SCALE = 1;
/** Lines further than this from the active one stop softening further. */
const MAX_DISTANCE = 6;

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Push scale onto the active line and depth blur onto the rest by distance. */
function paint(lines: HTMLElement[]): void {
  const activeIndex = lines.findIndex((el) => el.classList.contains("Active"));

  lines.forEach((el, i) => {
    const isActive = i === activeIndex;
    el.style.setProperty("--punch-scale", isActive ? `${ACTIVE_SCALE}` : `${REST_SCALE}`);
    // No glow as requested by user, removed --punch-bloom

    if (activeIndex < 0) {
      el.style.removeProperty("--BlurAmount");
      return;
    }
    // Upstream already consumes --BlurAmount in its text-shadow, so depth
    // rides that existing channel rather than adding a filter.
    const distance = Math.min(Math.abs(i - activeIndex), MAX_DISTANCE);
    el.style.setProperty("--BlurAmount", `${distance * 0.9}px`);
  });
}

/**
 * Start watching the lyrics page. Safe to call before lyrics exist — it waits
 * for the container and re-attaches when ApplyLyrics replaces the content.
 */
export function startPunchLayer(): () => void {
  if (prefersReducedMotion()) return () => {};

  let contentObserver: MutationObserver | null = null;

  const attach = (content: HTMLElement) => {
    contentObserver?.disconnect();
    const repaint = () => paint(Array.from(content.querySelectorAll<HTMLElement>(".line")));
    contentObserver = new MutationObserver(repaint);
    contentObserver.observe(content, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
      childList: true,
    });
    repaint();
  };

  // ApplyLyrics rebuilds .LyricsContent wholesale, so watch the page for it.
  const pageObserver = new MutationObserver(() => {
    const content = document.querySelector<HTMLElement>(
      `${PAGE_SELECTOR} .LyricsContainer .LyricsContent`,
    );
    if (content && !content.dataset.punchAttached) {
      content.dataset.punchAttached = "1";
      attach(content);
    }
  });
  pageObserver.observe(document.body, { childList: true, subtree: true });

  const existing = document.querySelector<HTMLElement>(
    `${PAGE_SELECTOR} .LyricsContainer .LyricsContent`,
  );
  if (existing) {
    existing.dataset.punchAttached = "1";
    attach(existing);
  }

  return () => {
    pageObserver.disconnect();
    contentObserver?.disconnect();
  };
}
