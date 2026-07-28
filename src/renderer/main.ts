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
// Dropped when this entry replaced app.tsx (app.tsx:47-49), which made the
// Settings and Lyrics Manager buttons look dead: PopupModal.display() appends
// <sl-generic-modal> to document.body and both panels mount into it, but with
// no base rules the overlay has no positioning, size or backdrop — the click
// ran, React rendered, and nothing was visible. default.css:747 only *layers
// on top of* the polyfill ("loaded later"), so it cannot substitute for it.
// NPVLyrics.css is deliberately still omitted; it styles Spotify's chrome.
import "../css/polyfills/generic-modal-polyfill.css";
import "../css/polyfills/sonner-polyfill.css";
import "../components/ReactComponents/LyricsManager/styles.css";
import "tippy.js/dist/tippy.css";
import "./styles/punch.css";

import { installSpicetifyShim } from "./adapter/spicetifyShim.ts";
import {
  subscribeMusicState,
  onMusicStateChange,
  getMusicState,
} from "./adapter/musicState.ts";
import { setProgressProvider } from "./adapter/AppleMusicPlayer.ts";

let lastPositionMs = 0;
let lastUpdateTimestamp = Date.now();
let lastStatus = "closed";

onMusicStateChange((state) => {
  if (state.track) {
    lastPositionMs = state.track.position * 1000;
    lastUpdateTimestamp = Date.now();
  }
  lastStatus = state.status;
});

// The shim's PlayerAPI._contextPlayer.getPositionState needs the raw player
// position, but the shim must not import the adapter (it is installed before
// upstream loads). A global hand-off keeps the dependency one-way.
// Extrapolates position between 2s AppleScript polls so the lyric clock
// flows at a smooth 60fps instead of stalling between updates.
(globalThis as any).__sweetlyRawPositionMs = () => {
  if (lastStatus !== "playing") return lastPositionMs;
  return lastPositionMs + (Date.now() - lastUpdateTimestamp);
};
(globalThis as any).__sweetlyIsPlaying = () => getMusicState().status === "playing";

// One bad apply must not poison every later one.
//
// ApplyLyrics calls DestroyAllLyricsContainers() *before* it rebuilds, so if
// anything throws partway the container is left detached. The next apply then
// reaches CreateLyricsContainer.ts:36, `ResizeListener.unobserve(
// Container.parentElement)` — and parentElement is null on a detached node, so
// unobserve throws a TypeError before a single line can render. Every
// subsequent track then fails identically: one unsynced song blanked the rest
// of the session.
//
// Unobserving something that is not an Element is meaningless rather than
// dangerous — there is nothing to stop observing — so absorbing it costs
// nothing and breaks the cascade.
const nativeUnobserve = ResizeObserver.prototype.unobserve;
ResizeObserver.prototype.unobserve = function (target: Element) {
  if (!(target instanceof Element)) {
    console.warn("[Sweetly] ignoring ResizeObserver.unobserve on a non-Element");
    return;
  }
  return nativeUnobserve.call(this, target);
};

installSpicetifyShim();

function trackKey(): string | null {
  const track = getMusicState().track;
  if (!track) return null;
  return `${track.artistCleaned}--${track.nameCleaned}`;
}

async function start(): Promise<void> {
  // One dynamic import of the barrel, not several in parallel — see upstream.ts
  // for why the evaluation order matters.
  const upstream = await import("./upstream.ts");
  const {
    PageView,
    ApplyDynamicBackground,
    LoadFonts,
    ApplyFontPixel,
    UpdateNowBar,
    ApplyLyrics,
    GetProgress,
    requestPositionSync,
    $currentLyricsType,
    $currentlyFetching,
    IntervalManager,
    ScrollingIntervalTime,
  } = upstream;
  // ScrollToActiveLine and especially ScrollSimplebar are deliberately NOT
  // destructured — ScrollSimplebar is a live `export let` that gets nulled and
  // reassigned on every track. Read both off `upstream`. See upstream.ts.

  // Hand upstream's smoothed clock to the adapter. Doing it here rather than by
  // import avoids an ESM cycle — see the comment in AppleMusicPlayer.ts.
  setProgressProvider(GetProgress);

  const { fetchLyricsForCurrentTrack } = await import("./lyrics/fetchLyricsElectron.ts");
  const { installViewControlBehaviour } = await import("./adapter/viewControls.ts");
  const { createEventPump } = await import("./adapter/eventPump.ts");

  LoadFonts();
  ApplyFontPixel();

  subscribeMusicState();

  const mount = document.getElementById("app");
  if (!mount) throw new Error("#app mount point missing from index.html");
  await PageView.Open(mount);

  // Enter Fullscreen Cinema View (Spicy's full-screen lyrics layout with artwork, scrubbar, and right-column lyrics)
  const { default: Fullscreen } = await import("../components/Utils/Fullscreen.ts");
  Fullscreen.Open(true);

  installViewControlBehaviour();

  // app.tsx:765-769, which our entry never reproduced. Without it
  // ScrollToActiveLine is dead code — app.tsx:767 is its only invocation site in
  // the whole tree — so the active line is never centred, and because
  // scrollLyricsToIndex (LyricsVirtualizer.ts:977) is called from exactly one
  // place (ScrollToActiveLine.ts:155) the virtualizer never advances past its
  // initial mount window. It is also the only thing that clears HideLineBlur
  // (ScrollToActiveLine.ts:424) after a user wheel event.
  //
  // ScrollingIntervalTime is Infinity, which IntervalManager maps to a
  // per-animation-frame callback rather than a setInterval. The guards inside
  // ScrollToActiveLine make it a cheap no-op until lyrics land.
  new IntervalManager(ScrollingIntervalTime, () => {
    if (upstream.ScrollSimplebar) {
      upstream.ScrollToActiveLine(upstream.ScrollSimplebar);
    }
  }).Start();

  const { startPunchLayer } = await import("./lyrics/punchLayer.ts");
  startPunchLayer();

  // app.tsx:919-923 polled at 0.5s and evoked playback:position; 969-977 wired
  // songchange/playpause off Spotify's player events. Our entry reproduced
  // neither, leaving NowBar's progress bar frozen at 0:00 and
  // dynamicBackground's artwork crossfade dead. See adapter/eventPump.ts.
  console.log(
    "[Sweetly] diag: Global bus:", typeof upstream.Global?.Event?.evoke,
    "| .ViewControl count:", document.querySelectorAll(".ViewControl").length,
    "| control ids:", [...document.querySelectorAll(".ViewControl")].map((e) => e.id).join(","),
    "| Fullscreen.IsOpen:", (upstream.Fullscreen as any)?.IsOpen,
  );

  let diagTicks = 0;
  const pump = createEventPump({
    evoke: (name, payload) => {
      if (name !== "playback:position" || diagTicks < 3) {
        console.log("[Sweetly] diag: evoke:", name);
      }
      upstream.Global.Event.evoke(name, payload);
    },
    getPosition: () => GetProgress(),
    isPlaying: () => getMusicState().status === "playing",
    getUri: () => trackKey() ?? undefined,
  });
  new IntervalManager(0.5, () => {
    if (diagTicks < 3) {
      console.log("[Sweetly] diag: pump tick", diagTicks, "pos:", GetProgress(), "uri:", trackKey());
    }
    diagTicks += 1;
    pump.tick();
  }).Start();

  let lastKey: string | null = null;

  async function loadLyricsForCurrentTrack(): Promise<void> {
    // Guard against out-of-order resolution. A track whose lyrics exhaust every
    // provider (Hot N' Cold has neither Apple nor LRCLIB coverage) can take
    // many seconds; skip to another track meanwhile and the slow fetch would
    // resolve last and paint its empty result over the new track's lyrics,
    // leaving the overlay blank until the next switch.
    const requestedFor = trackKey();
    const result = await fetchLyricsForCurrentTrack();
    if (trackKey() !== requestedFor) {
      console.log("[Sweetly] discarding stale lyrics result for:", requestedFor);
      return;
    }

    const contentBox = document.querySelector<HTMLElement>("#SpicyLyricsPage .ContentBox") || document.querySelector<HTMLElement>(".ContentBox") || document.body;
    if (contentBox) void ApplyDynamicBackground(contentBox, "lpagebg");

    // Upstream's fetchLyrics.ts does this in presentLyrics() (line 38-48) —
    // publishing the type is not cosmetic bookkeeping, it is what makes the
    // lyrics visible at all. LyricsSetter.ts:32 and LyricsAnimator.ts:451 both
    // dispatch on $currentLyricsType; left at "None" they assign no
    // Active/Sung/NotSung classes, and Mixed.css:75-85 only paints a
    // background-image (the only thing that shows glyphs, since .line/.word/
    // .letter set -webkit-text-fill-color: transparent) on .line.Active.
    // ScrollToActiveLine.ts:113 also early-returns on "None".
    const container = document.querySelector<HTMLElement>(".ContentBox");
    container?.classList.remove("LyricsHidden");
    document.querySelector(".ContentBox .LyricsContainer")?.classList.remove("Hidden");

    const [content] = result;
    if (typeof content === "string") {
      $currentLyricsType.set("None");
    } else {
      $currentLyricsType.set(content.Type);
    }
    $currentlyFetching.set(false);

    console.log(
      "[Sweetly] diag: applying:", requestedFor,
      "| descriptor:", typeof content === "string" ? content : `Type=${(content as any)?.Type}`,
      "| Unsynced:", (content as any)?.Unsynced,
      "| containerExists:", upstream.$lyricsContainerExists.get(),
      "| PageContainer:", !!upstream.PageContainer,
    );

    try {
      await ApplyLyrics(result as any);
      console.log(
        "[Sweetly] diag: applied OK:", requestedFor,
        "| containerExists now:", upstream.$lyricsContainerExists.get(),
        "| .line count:", document.querySelectorAll(".LyricsContent .line").length,
      );
    } catch (err) {
      // Previously `void loadLyricsForCurrentTrack()` swallowed this entirely,
      // so a throw on one track was invisible even though it can leave the
      // containers destroyed (ApplyLyrics calls DestroyAllLyricsContainers
      // before it builds).
      console.error("[Sweetly] diag: ApplyLyrics THREW for:", requestedFor, err);
      throw err;
    }
  }

  (globalThis as any).__sweetlyReloadLyrics = loadLyricsForCurrentTrack;
  window.addEventListener("lyrics-config-changed", () => {
    loadLyricsForCurrentTrack();
  });

  onMusicStateChange((state) => {
    UpdateNowBar();
    requestPositionSync();

    const key = state.track ? `${state.track.artistCleaned}--${state.track.nameCleaned}` : null;
    if (key === lastKey) return;
    lastKey = key;
    if (!key) return;

    loadLyricsForCurrentTrack().catch((err) => {
      console.error("[Sweetly] diag: lyrics load failed for:", key, err);
    });
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
