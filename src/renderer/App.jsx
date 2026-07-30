import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { parseTTMLData, getActiveIndices } from "../utils/ttmlParser.js";
import { Spring } from "../modules/Spring";
import {
  createWordSprings,
  ScaleSpline, YOffsetSpline, GlowSpline,
  getElementState, getProgressPercentage,
  setStyleIfChanged, flushStyleBatch
} from "./animationEngine.js";

function prewarmFonts() {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  return document.fonts.ready.then(() => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.font = "700 24px SpicyLyrics, Vazirmatn, sans-serif";
        ctx.measureText("AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789•");
      }
    } catch {}
  });
}


const DEBUG = false;

const reducedMotionQuery =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => reducedMotionQuery?.matches ?? false);
  useEffect(() => {
    if (!reducedMotionQuery) return;
    const onChange = (e) => setReduced(e.matches);
    reducedMotionQuery.addEventListener("change", onChange);
    return () => reducedMotionQuery.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

const BG_STATIC = (url, palette) => {
  let bgStyle = {};
  if (palette && palette.length > 0) {
    const c0 = palette[0] || "rgba(255,45,85,0.4)";
    const c1 = palette[1] || "rgba(88,86,214,0.4)";
    const c2 = palette[2] || "rgba(255,149,0,0.3)";
    bgStyle = {
      background: `radial-gradient(circle at 25% 25%, ${c0} 0%, transparent 60%),
                   radial-gradient(circle at 75% 75%, ${c1} 0%, transparent 60%),
                   radial-gradient(circle at 50% 50%, ${c2} 0%, transparent 70%),
                   #08080a`,
      filter: "blur(60px) saturate(2.0) brightness(0.85)",
      transform: "scale(1.2)",
    };
  } else if (url) {
    bgStyle = {
      background: `url(${url}) center/cover no-repeat`,
      filter: "blur(140px) saturate(2.2) brightness(0.25)",
      transform: "scale(1.15)",
    };
  } else {
    bgStyle = {
      background: "radial-gradient(ellipse at 40% 40%, rgba(255,255,255,0.05), transparent 70%), #08080a",
    };
  }
  return {
    position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
    ...bgStyle,
  };
};

function log(...args) { if (DEBUG) console.log("[Sweetly-UI]", ...args); }
function err(...args) { console.error("[Sweetly-UI]", ...args); }

const HEADER = {
  position: "fixed", top: 0, left: 0, right: 0, height: 44,
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "0 28px", zIndex: 20,
  background: "linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)",
  WebkitAppRegion: "drag",
};

const TOGGLE_BTN = {
  width: 28, height: 28, borderRadius: 6,
  border: "1px solid rgba(255, 255, 255, 0.1)",
  background: "rgba(255, 255, 255, 0.04)", color: "rgba(255, 255, 255, 0.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", WebkitAppRegion: "no-drag",
  transition: "all 0.2s ease",
  outline: "none",
};

const STATUS_BADGE = {
  fontSize: 10, opacity: 0.45, color: "#aaa",
  textTransform: "uppercase", letterSpacing: "0.12em",
  WebkitAppRegion: "no-drag",
};

const CONTAINER = {
  width: "100vw", height: "100vh", background: "#08080a",
  display: "flex", position: "relative", overflow: "hidden",
  WebkitAppRegion: "drag",
};

const GRAIN = {
  position: "fixed", inset: 0, zIndex: 19, pointerEvents: "none",
  opacity: 0.03, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
};

// z-index scale: 0=bg, 1=vignette, 2=content, 9=lyrics, 19=grain, 20=header, 99=debug

const VIGNETTE = {
  position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none",
  background: "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.65) 100%)",
};

// Layout for the now-playing column lives in index.html (.now-playing,
// .artwork, .progress-row, .song-title, .song-artist) so it can respond to
// the window size — this panel has to work at both 520x380 and fullscreen.

const IMG_FIT = { width: "100%", height: "100%", objectFit: "cover" };
const NOTE = { opacity: 0.12, color: "#fff", fontSize: 56 };

const ICON_BTN = {
  background: "none", border: "none", color: "#fff",
  fontSize: "1.1rem", cursor: "pointer", opacity: 0.85,
  transition: "transform 0.1s ease, opacity 0.15s ease",
  padding: 6, display: "flex", alignItems: "center", justifyContent: "center",
};

const ICON_BTN_LG = {
  background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
  borderRadius: "50%", width: 40, height: 40,
  fontSize: "1.2rem", cursor: "pointer", opacity: 0.95,
  display: "flex", alignItems: "center", justifyContent: "center",
  backdropFilter: "blur(6px)", transition: "transform 0.15s ease, background 0.15s ease",
};

const PLAY_PAUSE_BTN = {
  background: "#fff", border: "none", color: "#000",
  borderRadius: "50%", width: 52, height: 52,
  fontSize: "1.4rem", cursor: "pointer", fontWeight: "bold",
  display: "flex", alignItems: "center", justifyContent: "center",
  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
  transition: "transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
};

const PROGRESS_BAR = {
  flex: 1, height: 4, background: "rgba(255,255,255,0.15)",
  borderRadius: 2, overflow: "hidden", cursor: "pointer",
};

const PROGRESS_FILL = (pct, accent) => ({
  height: "100%", width: `${pct}%`, background: accent || "#fff",
  borderRadius: 2, boxShadow: `0 0 10px ${accent || "rgba(255,255,255,0.5)"}`,
  transition: "width 0.3s linear",
});

const TIMESTAMP = {
  fontSize: 10, color: "rgba(255,255,255,0.35)",
  fontFamily: "monospace", minWidth: 34, textAlign: "center",
  WebkitAppRegion: "no-drag",
};

const LOADER_BAR = {
  marginTop: 20, width: 40, height: 3,
  background: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden",
};

const RIGHT_PANEL = {
  flex: 1, height: "100vh", overflowY: "auto", overflowX: "visible",
  scrollbarWidth: "none", position: "relative", zIndex: 9, WebkitAppRegion: "no-drag",
  padding: "0 36px 0 24px", width: "100%",
  maskImage: "linear-gradient(to bottom, transparent 0%, transparent 16px, black 64px, black calc(100% - 64px), transparent calc(100% - 16px), transparent 100%)",
  WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, transparent 16px, black 64px, black calc(100% - 64px), transparent calc(100% - 16px), transparent 100%)",
};

const LYRICS_INNER = {
  display: "flex", flexDirection: "column",
  alignItems: "flex-start",
  marginTop: "25cqh", marginBottom: "45cqh",
  width: "100%", maxWidth: "none",
};

const FALLBACK = {
  display: "flex", flexDirection: "column", alignItems: "center",
  justifyContent: "center", height: "100vh", padding: "0 48px",
  textAlign: "center", position: "relative", zIndex: 2,
};

const FALLBACK_TITLE = { fontSize: 24, fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: 12 };
const FALLBACK_SUB = { fontSize: 14, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 };

const DEBUG_BAR = {
  position: "fixed", bottom: 0, left: 0, right: 0,
  background: "rgba(255, 0, 0, 0.75)", color: "#fff",
  fontSize: 9, fontFamily: "monospace", padding: "3px 8px",
  zIndex: 9999, lineHeight: 1.3, WebkitAppRegion: "no-drag", pointerEvents: "none",
};

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(e) { return { hasError: true, error: e }; }
  componentDidCatch(e, i) { console.error("[Sweetly-UI]", e, i); }
  render() {
    if (this.state.hasError) return (
      <div style={CONTAINER}><div style={FALLBACK}>
        <div style={{ ...FALLBACK_TITLE, color: "#ff6666" }}>App Crashed</div>
        <div style={FALLBACK_SUB}>{this.state.error?.message || "Unknown"}</div>
        <button style={{ ...TOGGLE_BTN, marginTop: 16, width: "auto", padding: "4px 12px", color: "#fff", fontSize: 11 }} onClick={() => window.electronAPI?.toggleFullscreen()}>Toggle</button>
      </div></div>
    );
    return this.props.children;
  }
}

async function fetchLyricsForTrack(track) {
  if (!track?.nameCleaned || track.nameCleaned === "Unknown Track") return null;
  try {
    const r = await window.electronAPI?.fetchLyrics?.({ name: track.nameCleaned, artist: track.artistCleaned, album: track.album });
    if (!r) return null;
    return { parsed: r.data ? parseTTMLData(r.data, r.provider) : null, artworkUrl: r.artworkUrl || null };
  } catch (e) { err("fetchLyrics:", e); return null; }
}

function extractPalette(imageUrl) {
  return new Promise((resolve) => {
    if (!imageUrl) { resolve([]); return; }
    const img = new Image();
    if (!imageUrl.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        const colorMap = new Map();
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 20) continue;
          const r = Math.round(data[i] / 32) * 32;
          const g = Math.round(data[i + 1] / 32) * 32;
          const b = Math.round(data[i + 2] / 32) * 32;
          const key = `${r},${g},${b}`;
          colorMap.set(key, (colorMap.get(key) || 0) + 1);
        }
        const sorted = [...colorMap.entries()].sort((a, b) => b[1] - a[1]);
        const colors = sorted.slice(0, 5).map(([key]) => {
          const [r, g, b] = key.split(",").map(Number);
          const h = Math.round((Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180 / Math.PI + 360) % 360);
          const s = Math.round((1 - Math.min(r, g, b) / Math.max(r, g, b, 1)) * 100);
          return `hsl(${h}, ${Math.min(s, 70)}%, 55%)`;
        });
        log("Palette:", colors.length, "colors extracted");
        resolve(colors);
      } catch { resolve([]); }
    };
    img.onerror = () => { log("Palette: image load failed"); resolve([]); };
    img.src = imageUrl;
  });
}

// Media-control glyphs. These were emoji (🔀 ⏮ ❚❚ ⏭ 🔁), which macOS renders
// as full-colour Apple emoji — visually unrelated to the line icons in the
// header bar.
const stroke = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" };

function IconPrev() {
  return <svg width="18" height="18" viewBox="0 0 18 18"><path d="M14 4v10l-7-5zM4 4v10" {...stroke} /></svg>;
}
function IconNext() {
  return <svg width="18" height="18" viewBox="0 0 18 18"><path d="M4 4v10l7-5zM14 4v10" {...stroke} /></svg>;
}
function IconPlay() {
  return <svg width="20" height="20" viewBox="0 0 20 20"><path d="M6 4l10 6-10 6z" fill="currentColor" /></svg>;
}
function IconPause() {
  return <svg width="20" height="20" viewBox="0 0 20 20"><rect x="5" y="4" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="11.5" y="4" width="3.5" height="12" rx="1" fill="currentColor" /></svg>;
}
function IconShuffle() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path d="M2 5h3l8 8h3M2 13h3l8-8h3" {...stroke} />
      <path d="M14 2.5L16.5 5 14 7.5M14 10.5L16.5 13 14 15.5" {...stroke} />
    </svg>
  );
}
function IconRepeat() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path d="M4 7V6a2 2 0 012-2h8M14 11v1a2 2 0 01-2 2H4" {...stroke} />
      <path d="M12 2l2 2-2 2M6 12l-2 2 2 2" {...stroke} />
    </svg>
  );
}
function IconRepeatOne() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path d="M4 7V6a2 2 0 012-2h8M14 11v1a2 2 0 01-2 2H4" {...stroke} />
      <path d="M12 2l2 2-2 2M6 12l-2 2 2 2" {...stroke} />
      <text x="9" y="11.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" stroke="none">1</text>
    </svg>
  );
}

function KaraokeWord({ word, lineIndex, wordIndex, registerWordRef }) {
  const isParenthetical = typeof word?.text === "string" && (word.text.trim().startsWith("(") || word.text.trim().endsWith(")"));
  return (
    <span
      ref={(el) => registerWordRef(lineIndex, wordIndex, el)}
      className={`word ${isParenthetical ? "parenthetical-word" : ""}`}
    >
      <span className="word-base">{word.text}</span>
      <span className="word-fill">{word.text}</span>
    </span>
  );
}

function LyricsView({ parsedLyrics, activeIndices, currentTime, rawClockPosRef, accent, reducedMotion, offset = 0 }) {
  const scrollRef = useRef(null);
  const isUserScrollingRef = useRef(false);
  const userScrollTimerRef = useRef(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const { line: activeLine } = activeIndices || {};

  const activeLineRef = useRef(activeLine);
  activeLineRef.current = activeLine;

  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  const accentRef = useRef(accent);
  accentRef.current = accent;

  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  // No timings in the source — show every line as plain readable text instead
  // of sweeping against times that are all zero.
  const unsynced = parsedLyrics?.unsynced === true;
  const unsyncedRef = useRef(unsynced);
  unsyncedRef.current = unsynced;

  const lineRefs = useRef(new Map());
  const wordRefs = useRef(new Map());
  const dotRefs = useRef(new Map());

  const scrollSpringRef = useRef(new Spring(0, 3, 0.65));
  const targetScrollRef = useRef(0);
  const wasUserScrollingRef = useRef(false);
  const lineSpringsMap = useRef(new Map());

  const registerLineRef = useCallback((li, el) => {
    if (el) lineRefs.current.set(li, el);
    else lineRefs.current.delete(li);
  }, []);

  const registerWordRef = useCallback((li, wi, el) => {
    const key = `${li}-${wi}`;
    if (el) wordRefs.current.set(key, el);
    else wordRefs.current.delete(key);
  }, []);

  const registerDotRef = useCallback((li, di, el) => {
    const key = `${li}-${di}`;
    if (el) dotRefs.current.set(key, el);
    else dotRefs.current.delete(key);
  }, []);

  const handleUserScroll = useCallback(() => {
    isUserScrollingRef.current = true;
    setIsUserScrolling(true);
    if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
    userScrollTimerRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
      setIsUserScrolling(false);
    }, 4000);
  }, []);

  const handleResumeSync = useCallback(() => {
    isUserScrollingRef.current = false;
    setIsUserScrolling(false);
    if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
    if (scrollRef.current && activeLine != null && activeLine >= 0) {
      const lineEl = lineRefs.current.get(activeLine);
      if (lineEl) {
        const container = scrollRef.current;
        const target = Math.max(0, lineEl.offsetTop - container.clientHeight * 0.5 + lineEl.offsetHeight * 0.5);
        scrollSpringRef.current = new Spring(container.scrollTop, 3.5, 0.65);
        scrollSpringRef.current.SetGoal(target);
      }
    }
  }, [activeLine]);

  const lines = parsedLyrics?.lines;
  const lineCount = lines?.length || 0;

  useEffect(() => {
    if (activeLine == null || activeLine < 0 || !scrollRef.current || isUserScrollingRef.current) return;
    const lineEl = lineRefs.current.get(activeLine);
    if (!lineEl) return;
    const container = scrollRef.current;
    const target = Math.max(0, lineEl.offsetTop - container.clientHeight * 0.5 + lineEl.offsetHeight * 0.5);
    targetScrollRef.current = target;
    scrollSpringRef.current.SetGoal(target);
  }, [activeLine]);

  // Springs are keyed by line index, so they must not survive a track change —
  // otherwise line 12 of the new song inherits line 12 of the old song's
  // opacity and blur mid-flight.
  useEffect(() => {
    lineSpringsMap.current.clear();
    scrollSpringRef.current = new Spring(0, 3, 0.65);
    targetScrollRef.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [lines]);

  useEffect(() => {
    if (!lines || lineCount === 0) return;
    let running = true;
    let lastTime = performance.now();
    let frameId;

    const tick = (now) => {
      if (!running) return;
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const curTime = (rawClockPosRef?.current || currentTimeRef.current) - offsetRef.current;
      const accentColor = accentRef.current || "#ffffff";
      const reduced = reducedMotionRef.current;
      const isUnsynced = unsyncedRef.current;
      const liveActive = isUnsynced ? { line: -1, word: -1 } : getActiveIndices(lines, curTime);
      const activeLineIdx = isUnsynced ? -1 : (liveActive.line >= 0 ? liveActive.line : (activeLineRef.current ?? -1));

      if (isUserScrollingRef.current !== wasUserScrollingRef.current) {
        wasUserScrollingRef.current = isUserScrollingRef.current;
        if (!isUserScrollingRef.current && scrollRef.current) {
          scrollSpringRef.current = new Spring(scrollRef.current.scrollTop, 3, 0.65);
          scrollSpringRef.current.SetGoal(targetScrollRef.current);
        }
      }
      // Unsynced text: leave scrolling entirely to the user.
      if (!isUserScrollingRef.current && scrollRef.current && !isUnsynced) {
        if (reduced) {
          scrollRef.current.scrollTop = targetScrollRef.current;
        } else {
          const scrollPos = scrollSpringRef.current.Step(dt);
          if (Math.abs(scrollRef.current.scrollTop - scrollPos) > 0.3) {
            scrollRef.current.scrollTop = scrollPos;
          }
        }
      }

      for (let li = 0; li < lineCount; li++) {
        const line = lines[li];
        const lineEl = lineRefs.current.get(li);
        if (!lineEl || !lineEl.isConnected) continue;

        const isBackground = line.isBackground === true;
        const isDotLine = line.isDotLine === true;
        const isLineActive = li === activeLineIdx;
        const dist = Math.abs(li - activeLineIdx);

        let lineSprings = lineSpringsMap.current.get(li);
        if (!lineSprings) {
          lineSprings = {
            opacity: new Spring(0.25, 3, 0.6),
            blur: new Spring(0, 2, 0.6),
          };
          lineSpringsMap.current.set(li, lineSprings);
        }

        let opacityGoal = isUnsynced
          ? (isBackground ? 0.62 : 0.92)
          : isLineActive ? (isBackground ? 0.75 : 1.0) : (li < activeLineIdx ? (isBackground ? 0.45 : Math.max(0.48, 0.88 - dist * 0.10)) : (isBackground ? 0.35 : Math.max(0.42, 0.75 - dist * 0.10)));

        const blurGoal = (reduced || isUnsynced) ? 0 : (isLineActive ? 0 : Math.min(6.25, dist * 1.25));
        lineSprings.opacity.SetGoal(opacityGoal, reduced);
        lineSprings.blur.SetGoal(blurGoal, reduced);

        const curOpacity = lineSprings.opacity.Step(dt);
        const curBlur = lineSprings.blur.Step(dt);

        setStyleIfChanged(lineEl, "opacity", `${curOpacity}`, 0.001);
        setStyleIfChanged(lineEl, "filter", curBlur > 0.1 ? `blur(${curBlur.toFixed(2)}px)` : "none");

        if (isDotLine && line.dots) {
          for (let di = 0; di < line.dots.length; di++) {
            const dot = line.dots[di];
            const dotEl = dotRefs.current.get(`${li}-${di}`);
            if (!dotEl || !dotEl.isConnected) continue;
            const dotState = getElementState(curTime, dot.startTime, dot.endTime);
            const dotPct = getProgressPercentage(curTime, dot.startTime, dot.endTime);
            const bgSweep = dotState === "Sung" ? 100 : (dotState === "Active" ? (dotPct * 100).toFixed(1) : 0);
            const fillEl = dotEl.children[1];
            if (fillEl) {
              setStyleIfChanged(fillEl, "--sweep", `${bgSweep}%`);
              setStyleIfChanged(fillEl, "--accent-color", accentColor);
            }
          }
          continue;
        }

        if (!line.words) continue;
        for (let wi = 0; wi < line.words.length; wi++) {
          const word = line.words[wi];
          const wordEl = wordRefs.current.get(`${li}-${wi}`);
          const wordState = getElementState(curTime, word.startTime, word.endTime);
          const wordPct = getProgressPercentage(curTime, word.startTime, word.endTime);
          if (!wordEl || !wordEl.isConnected) continue;
          if (!word.AnimatorStore) {
            word.AnimatorStore = createWordSprings();
            word.AnimatorStore.Scale.SetGoal(ScaleSpline.at(0), true);
            word.AnimatorStore.YOffset.SetGoal(YOffsetSpline.at(0), true);
            word.AnimatorStore.Glow.SetGoal(GlowSpline.at(0), true);
          }
          let tScale, tYOffset, tGlow, tGrad;
          if (isUnsynced) {
            // Static text: no sweep, no lift — just legible words.
            tScale = 1;
            tYOffset = 0;
            tGlow = 0;
            tGrad = 100;
          } else if (wordState === "Active") {
            tScale = ScaleSpline.at(wordPct);
            tYOffset = YOffsetSpline.at(wordPct);
            tGlow = GlowSpline.at(wordPct);
            tGrad = -20 + 120 * wordPct;
          } else if (wordState === "NotSung") {
            tScale = ScaleSpline.at(0);
            tYOffset = YOffsetSpline.at(0);
            tGlow = GlowSpline.at(0);
            tGrad = -20;
          } else {
            tScale = ScaleSpline.at(1);
            tYOffset = YOffsetSpline.at(1);
            tGlow = GlowSpline.at(1);
            tGrad = 100;
          }
          // reduced motion: keep the karaoke sweep (that's the information),
          // drop the scale/lift flourish.
          word.AnimatorStore.Scale.SetGoal(reduced ? 1 : tScale, reduced);
          word.AnimatorStore.YOffset.SetGoal(reduced ? 0 : tYOffset, reduced);
          word.AnimatorStore.Glow.SetGoal(tGlow);
          const cScale = word.AnimatorStore.Scale.Step(dt);
          const cYOffset = word.AnimatorStore.YOffset.Step(dt);
          const sweepPct = Math.max(0, Math.min(100, tGrad));
          const fillEl = wordEl.children[1];
          setStyleIfChanged(wordEl, "transform", `translate3d(0, calc(1em * ${cYOffset}), 0)`, 0.001);
          setStyleIfChanged(wordEl, "scale", `${cScale}`, 0.001);
          if (fillEl) {
            setStyleIfChanged(fillEl, "--sweep", `${sweepPct.toFixed(1)}%`);
            setStyleIfChanged(fillEl, "--accent-color", accentColor);
          }
        }
      }
      flushStyleBatch();
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(frameId); };
  }, [lines, lineCount]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleUserScroll, { passive: true });
    el.addEventListener("touchstart", handleUserScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", handleUserScroll);
      el.removeEventListener("touchstart", handleUserScroll);
      if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
    };
  }, [handleUserScroll]);

  if (!lines || lineCount === 0) return <div style={FALLBACK}><div style={FALLBACK_TITLE}>No lyrics data</div></div>;

  return (
    <div ref={scrollRef} style={RIGHT_PANEL}>
      <div style={LYRICS_INNER}>
        {lines.map((line, li) => {
          const isBackground = line.isBackground === true;
          const isOpposite = line.oppositeAligned === true;
          const isDotLine = line.isDotLine === true;
          const isActiveLine = li === activeLine;

          if (isDotLine) {
            return (
              <div
                key={`line-${li}`}
                ref={(el) => registerLineRef(li, el)}
                className={`lyric-line ${isActiveLine ? "active" : ""}`}
                style={{ justifyContent: "center" }}
              >
                <div className="dot-group">
                  {line.dots.map((dot, di) => (
                    <span
                      key={di}
                      ref={(el) => registerDotRef(li, di, el)}
                      className="dot"
                      onClick={(e) => { e.stopPropagation(); if (dot.startTime >= 0) window.electronAPI?.seekTo(dot.startTime); }}
                    >
                      <span className="dot-base">•</span>
                      <span className="dot-fill">•</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          }

          const words = line.words || [];
          const lineStartTime = words[0]?.startTime ?? line.startTime ?? 0;
          const isNextBackground = lines[li + 1]?.isBackground === true;

          return (
            <div
              key={`line-${li}`}
              ref={(el) => registerLineRef(li, el)}
              className={`lyric-line ${isActiveLine ? "active" : ""} ${isBackground ? "background-vocal" : ""} ${isOpposite ? "opposite-aligned" : ""}`}
              style={{
                marginTop: isBackground ? 2 : 12,
                marginBottom: isNextBackground ? 2 : (isBackground ? 16 : 14),
                cursor: unsynced ? "default" : "pointer",
              }}
              onClick={() => { if (!unsynced && lineStartTime >= 0) window.electronAPI?.seekTo(lineStartTime); }}
            >
              {words.map((w, wi) => (
                <KaraokeWord
                  key={wi}
                  word={w}
                  lineIndex={li}
                  wordIndex={wi}
                  registerWordRef={registerWordRef}
                />
              ))}
            </div>
          );
        })}
        <div className="lyrics-footer">
          <div className="footer-provider">
            {parsedLyrics?.provider === "spicylyrics" ? "Provided by: Spicy Lyrics" : parsedLyrics?.provider === "lrclib" ? "Provided by: LRCLIB" : "Provided by: Apple Music"}
          </div>
          {parsedLyrics?.provider === "spicylyrics" && (
            <div className="footer-community">These lyrics have been provided by our community</div>
          )}
          {unsynced && (
            <div className="footer-community">No timed lyrics available — showing unsynced text</div>
          )}
        </div>
      </div>
      {isUserScrolling && (
        <button className="resume-sync-btn" onClick={handleResumeSync}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 9V3M3 5l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Resume Sync
        </button>
      )}
    </div>
  );
}

function formatTime(sec) {
  if (!sec || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ArtworkImage({ url }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false); setFailed(false);
  }, [url]);

  return (
    <>
      <div style={{ ...NOTE, position: "absolute", display: loaded && !failed ? "none" : "flex" }}>♪</div>
      <img
        src={url}
        alt=""
        style={{ ...IMG_FIT, opacity: loaded && !failed ? 1 : 0 }}
        onLoad={() => { setLoaded(true); log("Artwork loaded"); }}
        onError={() => { setFailed(true); err("Artwork failed:", url?.slice(0, 60)); }}
      />
    </>
  );
}

/**
 * Alignment progress. Capture runs for the length of the track and closing the
 * window kills the recording, so this has to be visible and say so.
 */
function AlignBanner({ status, now }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (status?.phase !== "capturing") return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [status?.phase]);

  if (!status) return null;

  let label;
  if (status.phase === "capturing") {
    const left = Math.max(0, Math.ceil((status.until - Date.now()) / 1000));
    label = `Listening to sync lyrics — ${formatTime(left)} left · keep this window open`;
  } else if (status.phase === "aligning") {
    label = "Aligning lyrics to audio…";
  } else if (status.phase === "failed") {
    label = `Lyric sync failed: ${status.reason || "unknown"}`;
  } else {
    return null;
  }

  return (
    <div className={`align-banner ${status.phase === "failed" ? "failed" : ""}`}>
      {status.phase !== "failed" && <span className="align-dot" />}
      {label}
    </div>
  );
}

function SettingsModal({ isOpen, onClose }) {
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSaveToken = async () => {
    if (!token.trim()) return;
    const ok = await window.electronAPI?.setMediaUserToken?.(token.trim());
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div className="settings-title">Sweetly Settings</div>
          <button style={TOGGLE_BTN} onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: 8 }}>
          Apple Music Media User Token (Word-level Lyrics API)
        </div>
        <input
          type="password"
          className="settings-input"
          placeholder="Paste media-user-token here..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "0.8rem", color: saved ? "#27c93f" : "transparent" }}>
            Token saved successfully!
          </div>
          <button style={{ ...TOGGLE_BTN, background: "rgba(255,255,255,0.15)", padding: "6px 16px", borderRadius: 8 }} onClick={handleSaveToken}>
            Save Token
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState({ status: "closed" });
  const [parsedLyrics, setParsedLyrics] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [artworkUrl, setArtworkUrl] = useState(null);
  const [palette, setPalette] = useState([]);
  const [displayAccent, setDisplayAccent] = useState(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [kawarpReady, setKawarpReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [alignStatus, setAlignStatus] = useState(null);
  // Positive = show lyrics later. Covers Bluetooth output latency (the capture
  // taps the stream before the BT hop) and any lead-in the recording missed.
  const [lyricsOffset, setLyricsOffset] = useState(() => {
    const v = parseFloat(localStorage.getItem("sweetly.lyricsOffset"));
    return Number.isFinite(v) ? v : 0;
  });
  const [offsetToast, setOffsetToast] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const controlsTimeoutRef = useRef(null);
  const artRef = useRef(null);
  const reducedMotion = useReducedMotion();

  // Playback options mirror Music.app — the poller is the source of truth,
  // these are only optimistic values between a click and the next poll.
  const isFavorited = state?.favorited === true;
  const isShuffle = state?.shuffle === true;
  const repeatMode = state?.repeat || "off";

  const handleMouseMove = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 3000);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    setControlsVisible(false);
  }, []);

  const kawarpRef = useRef(null);
  const kawarpCanvasRef = useRef(null);
  const mountCount = useRef(0);
  const ipcCount = useRef(0);
  const renderCount = useRef(0);
  const lastTrackRef = useRef(null);
  const parsedLyricsRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const basePosRef = useRef(0);
  const baseTimeRef = useRef(0);
  const lastReportedPosRef = useRef(0);
  const lastReportedTimeRef = useRef(0);
  const rafRef = useRef(null);
  const isPausedRef = useRef(true);
  const playbackRateRef = useRef(1);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings((prev) => !prev);
        return;
      }
      // [ / ] nudge lyric timing by 100ms, \ resets. Shift for 500ms steps.
      if (e.key === "[" || e.key === "]" || e.key === "\\") {
        e.preventDefault();
        setLyricsOffset((prev) => {
          const step = e.shiftKey ? 0.5 : 0.1;
          const next = e.key === "\\" ? 0 : Math.round((prev + (e.key === "]" ? step : -step)) * 100) / 100;
          localStorage.setItem("sweetly.lyricsOffset", String(next));
          return next;
        });
        setOffsetToast(true);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (!offsetToast) return;
    const id = setTimeout(() => setOffsetToast(false), 1400);
    return () => clearTimeout(id);
  }, [offsetToast, lyricsOffset]);

  useEffect(() => {
    log("App: waiting for fonts...");
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; log("App: fonts timed out, rendering anyway"); setFontsReady(true); }
    }, 3000);
    prewarmFonts().then(() => {
      if (!resolved) { resolved = true; clearTimeout(timeout); log("App: fonts pre-warmed & ready"); setFontsReady(true); }
    });
    return () => clearTimeout(timeout);
  }, []);

  const paletteVersionRef = useRef(0);

  useEffect(() => {
    if (artworkUrl) {
      const version = ++paletteVersionRef.current;
      extractPalette(artworkUrl).then((colors) => {
        if (version === paletteVersionRef.current && colors.length > 0) {
          setPalette(colors);
        }
      });
    }
  }, [artworkUrl]);

  // Crossfade the accent hue from the previous artwork's to the new one.
  // The hue carries across palettes in a ref — seeding the spring at its own
  // goal (as this used to) made it emit a constant value while still burning
  // a frame callback forever.
  const accentHueRef = useRef(null);

  useEffect(() => {
    if (palette.length === 0) { setDisplayAccent(null); accentHueRef.current = null; return; }
    const [targetH = 0, targetS = 50, targetL = 55] = (palette[0].match(/[\d.]+/g) || []).map(Number);

    let fromH = accentHueRef.current;
    if (fromH == null) {
      accentHueRef.current = targetH;
      setDisplayAccent(`hsl(${Math.round(targetH)}, ${targetS}%, ${targetL}%)`);
      return;
    }
    if (reducedMotion) {
      accentHueRef.current = targetH;
      setDisplayAccent(`hsl(${Math.round(targetH)}, ${targetS}%, ${targetL}%)`);
      return;
    }

    // Travel the short way around the colour wheel (350° -> 10° is +20, not -340).
    let goalH = targetH;
    if (goalH - fromH > 180) fromH += 360;
    else if (fromH - goalH > 180) goalH += 360;

    const spring = new Spring(fromH, 1.5, 0.8);
    spring.SetGoal(goalH);

    let running = true;
    let frameId;
    let last = performance.now();
    const loop = (now) => {
      if (!running) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const h = spring.Step(dt);
      accentHueRef.current = ((h % 360) + 360) % 360;
      setDisplayAccent(`hsl(${Math.round(accentHueRef.current)}, ${targetS}%, ${targetL}%)`);
      if (spring.CanSleep()) { accentHueRef.current = targetH; return; }
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(frameId); };
  }, [palette, reducedMotion]);

  useEffect(() => {
    let cancelled = false;
    setKawarpReady(false);
    // No source to render, or the user asked for less motion — don't spin up
    // a WebGL context at all.
    if (reducedMotion || (palette.length === 0 && !artworkUrl)) return;
    async function initKawarp() {
      try {
        const { Kawarp } = await import("@kawarp/core");
        if (cancelled) return;
        const canvas = kawarpCanvasRef.current;
        if (!canvas) return;

        // Context liveness check
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        if (!gl || gl.isContextLost()) {
          log("Kawarp: WebGL context unavailable or lost, falling back to static BG");
          setKawarpReady(false);
          return;
        }

        await new Promise((r) => requestAnimationFrame(r));
        if (cancelled) return;

        canvas.width = Math.round(window.innerWidth * (window.devicePixelRatio || 1));
        canvas.height = Math.round(window.innerHeight * (window.devicePixelRatio || 1));
        log("Kawarp: canvas", canvas.width, "x", canvas.height);

        if (kawarpRef.current) {
          try { kawarpRef.current.dispose(); } catch {}
          kawarpRef.current = null;
        }

        const k = new Kawarp(canvas, {
          warpIntensity: 0.6, blurPasses: 8, animationSpeed: 0.7,
          transitionDuration: 600, saturation: 1.4,
          tintColor: [0.06, 0.06, 0.10], tintIntensity: 0.18,
          dithering: 0.006, scale: 1.1,
        });

        if (cancelled) {
          try { k.dispose(); } catch {}
          return;
        }

        kawarpRef.current = k;
        if (palette.length > 0) {
          k.loadGradient(palette);
        } else if (artworkUrl) {
          k.loadImage(artworkUrl);
        } else {
          // Nothing to render yet. Dispose rather than abandon — leaking the
          // instance here burned a WebGL context per track until the browser
          // hit its context cap and Kawarp stopped working entirely.
          log("Kawarp: no source yet, deferring");
          try { k.dispose(); } catch {}
          kawarpRef.current = null;
          return;
        }
        k.start();
        if (!cancelled) setKawarpReady(true);
        log("Kawarp: started");
      } catch (e) {
        log("Kawarp: failed, using static fallback", e.message);
        setKawarpReady(false);
        if (!cancelled && kawarpCanvasRef.current) {
          kawarpCanvasRef.current.style.display = "none";
        }
      }
    }
    initKawarp();
    return () => {
      cancelled = true;
      if (kawarpRef.current) {
        try {
          kawarpRef.current.stop();
          kawarpRef.current.dispose();
        } catch {}
        kawarpRef.current = null;
      }
    };
  }, [artworkUrl, palette, reducedMotion]);

  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const artworkRef = useRef(artworkUrl);
  artworkRef.current = artworkUrl;

  useEffect(() => {
    const onBlur = () => {
      try { kawarpRef.current?.stop(); } catch {}
    };
    const onFocus = () => {
      try {
        if ((paletteRef.current.length > 0 || artworkRef.current) && kawarpRef.current) {
          kawarpRef.current.start();
        }
      } catch {}
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Artwork idle float. Written straight to the node — routing this through
  // React state re-rendered the entire tree (and re-attached every lyric ref)
  // 60 times a second.
  useEffect(() => {
    if (reducedMotion) {
      if (artRef.current) artRef.current.style.transform = "translateY(0px)";
      return;
    }
    let running = true;
    let frameId;
    const loop = () => {
      if (!running) return;
      const el = artRef.current;
      if (el) el.style.transform = `translateY(${(Math.sin(performance.now() / 4000) * 6).toFixed(2)}px)`;
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => { running = false; cancelAnimationFrame(frameId); };
  }, [reducedMotion]);

  const handleMusicUpdate = useCallback((newState) => {
    ipcCount.current++;
    const safe = newState && typeof newState === "object" ? newState : { status: "closed" };
    const isIncomingUnknown = !safe.track?.name || safe.track?.name === "Unknown Track";

    let ignored = false;
    setState((prevState) => {
      const hasPrevTrack = prevState?.track?.name && prevState.track.name !== "Unknown Track";
      if (isIncomingUnknown && hasPrevTrack) {
        log("IPC: ignoring transient Unknown Track poll");
        ignored = true;
        return prevState;
      }
      return safe;
    });

    if (isIncomingUnknown || ignored) return;

    const newPos = safe.track?.position ?? 0;
    const isPlaying = safe.status === "playing";
    const prevPaused = isPausedRef.current;
    isPausedRef.current = !isPlaying;

    const now = performance.now();
    const currentClockTime = basePosRef.current + ((now - baseTimeRef.current) / 1000) * playbackRateRef.current;
    const delta = newPos - currentClockTime;

    if (prevPaused && isPlaying) {
      basePosRef.current = newPos;
      baseTimeRef.current = now;
      playbackRateRef.current = 1;
      lastReportedPosRef.current = newPos;
      lastReportedTimeRef.current = now;
      log("Clock: unpaused, hard snap to", newPos);
    } else if (Math.abs(delta) > 1.5) {
      basePosRef.current = newPos;
      baseTimeRef.current = now;
      playbackRateRef.current = 1;
      lastReportedPosRef.current = newPos;
      lastReportedTimeRef.current = now;
      log("Clock: seek/jump detected (delta=" + delta.toFixed(2) + "s), hard snap to", newPos);
    } else {
      lastReportedPosRef.current = newPos;
      lastReportedTimeRef.current = now;
    }
  }, []);

  useEffect(() => {
    mountCount.current++; log(`App mounted (#${mountCount.current})`);
    if (window.electronAPI?.getInitialState) window.electronAPI.getInitialState().then((s) => { if (s && typeof s === "object") { log("Init: initial state", s?.status, s?.track?.name); const pos = s?.track?.position ?? 0; const now = performance.now(); basePosRef.current = pos; baseTimeRef.current = now; lastReportedPosRef.current = pos; lastReportedTimeRef.current = now; isPausedRef.current = s?.status !== "playing"; setState(s); } }).catch((e) => err("init:", e));
    return () => log("unmount");
  }, []);

  useEffect(() => {
    let c; if (window.electronAPI?.onMusicUpdate) c = window.electronAPI.onMusicUpdate(handleMusicUpdate);
    return () => { if (c) c(); };
  }, [handleMusicUpdate]);

  useEffect(() => {
    const track = state?.track; const status = state?.status;
    if (!track?.nameCleaned || status !== "playing" || track?.name === "Unknown Track") return;
    const key = `${track.nameCleaned}|||${track.artistCleaned}`;
    const needsRetry = status === "playing" && !parsedLyricsRef.current;
    if (lastTrackRef.current === key && !needsRetry) return;
    lastTrackRef.current = key;
    setParsedLyrics(null);
    setArtworkUrl(null);
    setFetching(true);
    fetchLyricsForTrack(track).then((r) => {
      const hasL = !!r?.parsed?.lines?.length;
      const hasA = !!r?.artworkUrl;
      log(`Init: lyrics=${hasL} lines=${r?.parsed?.lines?.length || 0} artwork=${hasA}`);
      setParsedLyrics(r?.parsed ?? null);
      setArtworkUrl(r?.artworkUrl || track?.artworkUrl || null);
      setFetching(false);
    }).catch(() => setFetching(false));
  }, [state?.track?.nameCleaned, state?.track?.artistCleaned, state?.status]);

  useEffect(() => {
    if (state?.track?.artworkUrl && !artworkUrl) {
      setArtworkUrl(state.track.artworkUrl);
    }
  }, [state?.track?.artworkUrl, artworkUrl]);

  // A background alignment finished. If it was for the track on screen, pull
  // the lyrics again — the aligner's TTML now sits in ~/.sweetly-custom and
  // the custom source is checked first, so this swaps unsynced text for
  // word-level sync without waiting for a track change.
  useEffect(() => {
    if (!window.electronAPI?.onLyricsUpdated) return;
    const off = window.electronAPI.onLyricsUpdated(({ name, artist } = {}) => {
      const track = stateRef.current?.track;
      if (!track?.nameCleaned) return;
      if (track.nameCleaned !== name || track.artistCleaned !== artist) return;
      log("Aligner: lyrics updated for current track, refetching");
      fetchLyricsForTrack(track).then((r) => {
        if (r?.parsed?.lines?.length) {
          setParsedLyrics(r.parsed);
          if (r.artworkUrl) setArtworkUrl(r.artworkUrl);
        }
      }).catch((e) => err("aligner refetch:", e));
    });
    return () => { if (off) off(); };
  }, []);

  // Alignment runs for the whole song with no other visible sign, and closing
  // the window kills the recording — so surface it.
  useEffect(() => {
    if (!window.electronAPI?.onAlignStatus) return;
    const off = window.electronAPI.onAlignStatus((payload) => {
      if (!payload?.phase) return;
      if (payload.phase === "capturing") {
        setAlignStatus({ phase: "capturing", until: Date.now() + payload.seconds * 1000 });
      } else if (payload.phase === "aligning") {
        setAlignStatus({ phase: "aligning" });
      } else {
        setAlignStatus(payload.phase === "failed" ? { phase: "failed", reason: payload.reason } : null);
        if (payload.phase === "failed") setTimeout(() => setAlignStatus(null), 6000);
      }
    });
    return () => { if (off) off(); };
  }, []);

  const rawClockPosRef = useRef(0);
  const lastSetTimeRef = useRef(0);

  // Monotonic 60fps clock with soft rate-scaling drift absorption
  useEffect(() => {
    if (state?.status !== "playing") {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const tick = () => {
      if (isPausedRef.current) return;
      const now = performance.now();
      const elapsed = (now - baseTimeRef.current) / 1000;
      const raw = basePosRef.current + elapsed * playbackRateRef.current;

      if (lastReportedTimeRef.current > 0) {
        const expectedApplePos = lastReportedPosRef.current + (now - lastReportedTimeRef.current) / 1000;
        const drift = expectedApplePos - raw;

        if (Math.abs(drift) > 0.05) {
          playbackRateRef.current = Math.max(0.98, Math.min(1.02, 1 + drift * 0.10));
        } else {
          playbackRateRef.current = 1;
        }
      }

      rawClockPosRef.current = raw;
      if (Math.abs(raw - lastSetTimeRef.current) >= 0.4) {
        lastSetTimeRef.current = raw;
        setCurrentTime(raw);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [state?.status]);

  const activeIndices = useMemo(() => {
    try {
      if (!parsedLyrics?.lines || parsedLyrics.unsynced) return { line: -1, word: -1 };
      return getActiveIndices(parsedLyrics.lines, currentTime - lyricsOffset);
    } catch { return { line: -1, word: -1 }; }
  }, [parsedLyrics, currentTime, lyricsOffset]);

  const title = state?.track?.name || "";
  const artist = state?.track?.artist || "";
  const hasTrack = Boolean(state?.track?.name);
  const hasLyrics = parsedLyrics?.lines?.length > 0;
  parsedLyricsRef.current = parsedLyrics;
  const showLoader = fetching || (state?.status === "playing" && !hasLyrics);
  const duration = state?.track?.duration || 0;
  const progressPct = duration > 0 ? ((currentTime || state?.track?.position || 0) / duration) * 100 : 0;

  let statusLabel, message = "";
  if (state?.status === "closed") { statusLabel = "Apple Music"; message = "Open Apple Music to begin"; }
  else if (state?.status === "paused") statusLabel = "Paused";
  else if (state?.status === "stopped") statusLabel = "Stopped";
  else if (!hasTrack) { statusLabel = "Idle"; message = "No track playing"; }
  else statusLabel = "Playing";

  renderCount.current++;
  const debugInfo = `s=${state?.status} t="${title}" l=${hasLyrics} ipc#${ipcCount.current} r#${renderCount.current}`;

  let fallbackText = null;
  if (hasTrack) { if (showLoader) fallbackText = "Syncing lyrics..."; else if (!hasLyrics) fallbackText = "Instrumental track"; }

  const kawarpBgStyle = {
    position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
  };

  if (!fontsReady) return <div style={CONTAINER}><div style={FALLBACK}><div style={FALLBACK_TITLE}>Sweetly</div></div></div>;

  return (
    <div style={CONTAINER} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <div style={BG_STATIC(artworkUrl, palette)} />
      <canvas ref={kawarpCanvasRef} style={{ ...kawarpBgStyle, opacity: kawarpReady ? 1 : 0, transition: "opacity 0.5s" }} />
      <div style={VIGNETTE} />
      <div style={GRAIN} />
      <div style={HEADER} onDoubleClick={() => window.electronAPI?.toggleFullscreen?.()}>
        <div className="mac-traffic-lights">
          <button className="mac-btn mac-close" onClick={() => window.close()} title="Close Window" />
          <button className="mac-btn mac-minimize" onClick={() => window.electronAPI?.toggleFullscreen?.()} title="Minimize Window" />
          <button className="mac-btn mac-expand" onClick={() => window.electronAPI?.toggleFullscreen?.()} title="Toggle Fullscreen" />
        </div>
        <div style={STATUS_BADGE}>{statusLabel}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={TOGGLE_BTN} onClick={() => window.electronAPI?.previousTrack?.()} title="Previous Track">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11 2v10L5 7zM3 2v10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button style={TOGGLE_BTN} onClick={() => window.electronAPI?.togglePlayPause?.()} title="Play / Pause">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="2" width="3" height="10" rx="0.5" fill="currentColor"/><rect x="8" y="2" width="3" height="10" rx="0.5" fill="currentColor"/></svg>
          </button>
          <button style={TOGGLE_BTN} onClick={() => window.electronAPI?.nextTrack?.()} title="Next Track">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2v10l6-5zM11 2v10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button style={TOGGLE_BTN} onClick={() => setShowSettings(true)} title="Settings (Cmd+,)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.2"/><path d="M7 1.5v1.5M7 11v1.5M1.5 7h1.5M11 7h1.5M3.1 3.1l1.1 1.1M9.8 9.8l1.1 1.1M3.1 10.9l1.1-1.1M9.8 4.2l1.1-1.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </button>
          <button style={TOGGLE_BTN} onClick={() => window.electronAPI?.toggleFullscreen?.()} title="Toggle Fullscreen (Cmd+Shift+F)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <path d="M3 4V2h2M11 4V2H9M3 10v2h2M11 10v2H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {!hasTrack && state?.status === "closed" ? (
        <div style={FALLBACK}><div style={FALLBACK_TITLE}>{message}</div></div>
      ) : (
        <div style={{ display: "flex", flex: 1, width: "100%", position: "relative", zIndex: 2 }}>
          <div className="now-playing">
            <div ref={artRef} className="artwork">
              {artworkUrl
                ? <ArtworkImage url={artworkUrl} />
                : <div style={NOTE}>♪</div>}

              {/* Artwork Hover Controls Overlay */}
              <div
                style={{
                  position: "absolute", inset: 0,
                  background: "rgba(0, 0, 0, 0.45)",
                  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                  opacity: controlsVisible ? 1 : 0,
                  pointerEvents: controlsVisible ? "auto" : "none",
                  transition: "opacity 0.25s ease, transform 0.25s ease",
                  display: "flex", flexDirection: "column",
                  justifyContent: "space-between", padding: 14,
                  borderRadius: "inherit", zIndex: 10,
                }}
              >
                {/* Top Control Bar */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="icon-btn" style={ICON_BTN} onClick={() => window.electronAPI?.toggleFullscreen?.()} title="Fullscreen Mode">
                      ⛶
                    </button>
                    <button className="icon-btn" style={ICON_BTN} onClick={() => setShowSettings(true)} title="Settings">
                      ⚙
                    </button>
                  </div>
                  <button className="icon-btn" style={ICON_BTN} onClick={() => window.close()} title="Close Window">
                    ✕
                  </button>
                </div>

                {/* Center Heart Like Button */}
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
                  <button
                    className="icon-btn"
                    style={{
                      background: "none", border: "none",
                      color: isFavorited ? "#ff2d55" : "rgba(255, 255, 255, 0.95)",
                      fontSize: "3.8rem", cursor: "pointer",
                      transition: "transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                      transform: isFavorited ? "scale(1.15)" : "scale(1)",
                      filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.5))",
                    }}
                    onClick={() => window.electronAPI?.toggleFavorite?.()}
                    title={isFavorited ? "Remove from Favorites" : "Add to Favorites"}
                  >
                    {isFavorited ? "♥" : "♡"}
                  </button>
                </div>

                {/* Bottom Media Controls */}
                <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", width: "100%" }}>
                  <button
                    className="icon-btn"
                    style={{ ...ICON_BTN, opacity: isShuffle ? 1 : 0.45 }}
                    onClick={() => window.electronAPI?.toggleShuffle?.()}
                    title={isShuffle ? "Shuffle: on" : "Shuffle: off"}
                  >
                    <IconShuffle />
                  </button>
                  <button
                    className="icon-btn"
                    style={ICON_BTN_LG}
                    onClick={() => window.electronAPI?.previousTrack?.()}
                    title="Previous Track"
                  >
                    <IconPrev />
                  </button>
                  <button
                    className="icon-btn"
                    style={PLAY_PAUSE_BTN}
                    onClick={() => window.electronAPI?.togglePlayPause?.()}
                    title="Play / Pause"
                  >
                    {state?.status === "playing" ? <IconPause /> : <IconPlay />}
                  </button>
                  <button
                    className="icon-btn"
                    style={ICON_BTN_LG}
                    onClick={() => window.electronAPI?.nextTrack?.()}
                    title="Next Track"
                  >
                    <IconNext />
                  </button>
                  <button
                    className="icon-btn"
                    style={{ ...ICON_BTN, opacity: repeatMode === "off" ? 0.45 : 1 }}
                    onClick={() => window.electronAPI?.cycleRepeat?.()}
                    title={`Repeat: ${repeatMode}`}
                  >
                    {repeatMode === "one" ? <IconRepeatOne /> : <IconRepeat />}
                  </button>
                </div>
              </div>
            </div>

            {hasTrack && duration > 0 && (
              <div className="progress-row">
                <div style={TIMESTAMP}>{formatTime(currentTime)}</div>
                <div
                  style={PROGRESS_BAR}
                  onClick={(e) => {
                    if (!duration) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const pct = Math.max(0, Math.min(1, clickX / rect.width));
                    window.electronAPI?.seekTo?.(pct * duration);
                  }}
                  title="Click to seek position"
                >
                  <div style={PROGRESS_FILL(progressPct, displayAccent)} />
                </div>
                <div style={TIMESTAMP}>{formatTime(duration)}</div>
              </div>
            )}
            <div className="song-title">{title || "No Track Playing"}</div>
            <div className="song-artist">{artist || "Apple Music"}</div>
            {showLoader && <div style={LOADER_BAR}><div style={{ width: "60%", height: "100%", background: "rgba(255,255,255,0.4)", borderRadius: 2, animation: "slide 1.2s ease-in-out infinite" }} /></div>}
          </div>
          <div style={{ flex: 1, height: "100vh", WebkitAppRegion: "no-drag" }}>
            {hasLyrics ? <LyricsView parsedLyrics={parsedLyrics} activeIndices={activeIndices} currentTime={currentTime} rawClockPosRef={rawClockPosRef} accent={displayAccent} reducedMotion={reducedMotion} offset={lyricsOffset} />
            : <div style={FALLBACK}>{hasTrack ? <><div style={FALLBACK_TITLE}>{fallbackText}</div><div style={FALLBACK_SUB}>{title} — {artist}</div></> : <div style={FALLBACK_TITLE}>{message}</div>}</div>}
          </div>
        </div>
      )}
      {offsetToast && (
        <div className="align-banner">
          Lyric offset {lyricsOffset > 0 ? "+" : ""}{lyricsOffset.toFixed(1)}s
          {lyricsOffset === 0 ? " (reset)" : lyricsOffset > 0 ? " — later" : " — earlier"}
        </div>
      )}
      <AlignBanner status={alignStatus} now={currentTime} />
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      {DEBUG && <div style={DEBUG_BAR}>{debugInfo}</div>}
    </div>
  );
}

export default function AppWithErrorBoundary() {
  const mounted = useRef(false);
  useEffect(() => { if (!mounted.current) { mounted.current = true; log("AppWithErrorBoundary"); } }, []);
  return <ErrorBoundary><App /></ErrorBoundary>;
}
