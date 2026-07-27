/**
 * Sweetly renderer entry. Models src/app.tsx, minus everything that exists to
 * embed into Spotify's chrome: NPVLyrics, PopupLyrics, the now-playing-bar
 * observers, the update dialog and the data migration.
 *
 * Import order is load-bearing. Static ESM imports are hoisted and run before
 * this module's body, so upstream JS is pulled in with dynamic import() after
 * installSpicetifyShim() has run — several upstream modules read Spicetify at
 * module scope and would throw otherwise. Stylesheets are safe as static
 * imports because they execute no JavaScript.
 */
import "../css/tokens.css";
import "../css/primitives.css";
import "../css/default.css";
import "../css/default.scss";
import "../css/Simplebar.css";
import "../css/ContentBox.css";
import "../css/DynamicBG/spicy-dynamic-bg.css";
import "../css/Lyrics/main.css";
import "../css/Lyrics/Mixed.css";
import "../css/Loaders/LoaderContainer.css";
import "../css/font-pack/font-pack.css";
import "../css/settings-panel.css";
import "tippy.js/dist/tippy.css";

import { installSpicetifyShim } from "./adapter/spicetifyShim.ts";
import {
  subscribeMusicState,
  onMusicStateChange,
  getMusicState,
} from "./adapter/musicState.ts";
import { setProgressProvider } from "./adapter/AppleMusicPlayer.ts";

// The shim's PlayerAPI._contextPlayer.getPositionState needs the raw player
// position, but the shim must not import the adapter (it is installed before
// upstream loads). A global hand-off keeps the dependency one-way.
(globalThis as any).__sweetlyRawPositionMs = () => {
  const track = getMusicState().track;
  return track ? track.position * 1000 : 0;
};
(globalThis as any).__sweetlyIsPlaying = () => getMusicState().status === "playing";

installSpicetifyShim();

function trackKey(): string | null {
  const track = getMusicState().track;
  if (!track) return null;
  return `${track.artistCleaned}--${track.nameCleaned}`;
}

async function start(): Promise<void> {
  // One dynamic import of the barrel, not several in parallel — see upstream.ts
  // for why the evaluation order matters.
  const {
    PageView,
    ApplyDynamicBackground,
    LoadFonts,
    ApplyFontPixel,
    UpdateNowBar,
    ApplyLyrics,
    GetProgress,
    requestPositionSync,
  } = await import("./upstream.ts");

  // Hand upstream's smoothed clock to the adapter. Doing it here rather than by
  // import avoids an ESM cycle — see the comment in AppleMusicPlayer.ts.
  setProgressProvider(GetProgress);

  const { fetchLyricsForCurrentTrack } = await import("./lyrics/fetchLyricsElectron.ts");
  const { installViewControlBehaviour } = await import("./adapter/viewControls.ts");

  LoadFonts();
  ApplyFontPixel();

  subscribeMusicState();

  const mount = document.getElementById("app");
  if (!mount) throw new Error("#app mount point missing from index.html");
  await PageView.Open(mount);

  installViewControlBehaviour();

  let lastKey: string | null = null;

  async function loadLyricsForCurrentTrack(): Promise<void> {
    const result = await fetchLyricsForCurrentTrack();

    const background = document.querySelector<HTMLElement>(".spicy-dynamic-bg");
    if (background) void ApplyDynamicBackground(background);

    await ApplyLyrics(result as any);

    // Temporary: report why lyrics are or are not visible. The applyers fail
    // silently — they return early on a false store rather than throwing — so
    // the DOM is the only place the answer actually lives.
    setTimeout(() => {
      const page = document.querySelector<HTMLElement>("#SpicyLyricsPage");
      const container = document.querySelector<HTMLElement>(".LyricsContainer");
      const content = document.querySelector<HTMLElement>(".LyricsContent");
      const line = document.querySelector<HTMLElement>(".line");
      console.log(
        "[Sweetly] dom:",
        JSON.stringify({
          pageClasses: page?.className ?? null,
          pageSize: page ? [page.clientWidth, page.clientHeight] : null,
          containerClasses: container?.className ?? null,
          containerSize: container ? [container.clientWidth, container.clientHeight] : null,
          contentChildren: content?.childElementCount ?? null,
          contentSize: content ? [content.clientWidth, content.clientHeight] : null,
          lineCount: document.querySelectorAll(".line").length,
          lineFontSize: line ? getComputedStyle(line).fontSize : null,
          lineOpacity: line ? getComputedStyle(line).opacity : null,
          lineText: line?.textContent?.slice(0, 40) ?? null,
          lineRect: line
            ? (() => {
                const r = line.getBoundingClientRect();
                return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
              })()
            : null,
          // opacity does not inherit into getComputedStyle, so a zeroed
          // ancestor is invisible from the line's own styles. Walk up.
          ancestry: line
            ? (() => {
                const chain: string[] = [];
                let el: HTMLElement | null = line;
                while (el && chain.length < 8) {
                  const cs = getComputedStyle(el);
                  chain.push(
                    `${el.tagName.toLowerCase()}.${(el.className || "-").toString().split(" ").join(".")}` +
                      ` op=${cs.opacity} vis=${cs.visibility} disp=${cs.display} col=${cs.color}`,
                  );
                  el = el.parentElement;
                }
                return chain;
              })()
            : null,
        }),
      );
    }, 2500);
  }

  onMusicStateChange((state) => {
    UpdateNowBar();
    requestPositionSync();

    const key = state.track ? `${state.track.artistCleaned}--${state.track.nameCleaned}` : null;
    if (key === lastKey) return;
    lastKey = key;
    if (!key) return;

    void loadLyricsForCurrentTrack();
  });

  // A music-update may already have landed before we subscribed.
  if (trackKey()) {
    lastKey = trackKey();
    UpdateNowBar();
    await loadLyricsForCurrentTrack();
  }
}

void start().catch((error) => {
  console.error("[Sweetly] renderer failed to start:", error);
});
