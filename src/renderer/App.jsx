import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { parseTTMLData, getActiveIndices } from "../utils/ttmlParser.js";
import { Spring } from "../modules/Spring";
import {
  createWordSprings, createLetterSprings, createDotSprings,
  ScaleSpline, YOffsetSpline, GlowSpline,
  LetterScaleSpline, LetterYOffsetSpline,
  DotScaleSpline, DotYOffsetSpline, DotGlowSpline, DotOpacitySpline,
  LetterGlowMultiplier_Opacity, SungLetterGlow,
  getElementState, getProgressPercentage, easeSinOut,
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

const LEFT_PANEL = {
  width: "36%", height: "100vh", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", padding: "0 20px",
  boxSizing: "border-box", position: "relative", zIndex: 2, WebkitAppRegion: "no-drag",
};

const ART_PLACEHOLDER = {
  width: 320, height: 320, borderRadius: 4,
  background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
  border: "2px solid rgba(255,255,255,0.15)",
  display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0, marginBottom: 32, overflow: "hidden",
  boxShadow: "0 12px 48px rgba(0,0,0,0.6)",
  position: "relative",
};

const IMG_FIT = { width: "100%", height: "100%", objectFit: "cover" };
const NOTE = { opacity: 0.12, color: "#fff", fontSize: 56 };

const PROGRESS_ROW = {
  width: 320, display: "flex", alignItems: "center", gap: 10,
  flexShrink: 0, marginBottom: 16,
};

const PROGRESS_BAR = {
  flex: 1, height: 3, background: "rgba(255,255,255,0.08)",
  borderRadius: 2, overflow: "hidden",
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

const SONG_TITLE = {
  fontSize: 22, fontWeight: 700, color: "#fff", textAlign: "center",
  maxWidth: 320, wordBreak: "break-word", WebkitAppRegion: "no-drag",
  textShadow: "0 2px 8px rgba(0,0,0,0.6)",
};

const SONG_ARTIST = {
  fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.4)",
  marginTop: 8, textAlign: "center", maxWidth: 320,
  wordBreak: "break-word", WebkitAppRegion: "no-drag",
};

const LOADER_BAR = {
  marginTop: 20, width: 40, height: 3,
  background: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden",
};

const RIGHT_PANEL = {
  flex: 1, height: "100vh", overflowY: "auto", overflowX: "visible",
  scrollbarWidth: "none", position: "relative", zIndex: 9, WebkitAppRegion: "no-drag",
  padding: "0 72px 0 48px",
  maskImage: "linear-gradient(to bottom, transparent 0%, transparent 16px, black 64px, black calc(100% - 64px), transparent calc(100% - 16px), transparent 100%)",
  WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, transparent 16px, black 64px, black calc(100% - 64px), transparent calc(100% - 16px), transparent 100%)",
};

const LYRICS_INNER = {
  display: "flex", flexDirection: "column",
  alignItems: "flex-start",
  marginTop: "25cqh", marginBottom: "45cqh",
  maxWidth: 800,
};

const LYRIC_LINE = {
  display: "flex", flexWrap: "wrap",
  alignItems: "baseline", justifyContent: "flex-start",
  marginBottom: 6, willChange: "opacity",
  padding: "0 12px",
  wordBreak: "keep-all",
  overflowWrap: "break-word",
  cursor: "pointer",
  borderRadius: 4,
  transition: "background 0.15s ease",
};

const WORD_BASE = {
  fontWeight: 700, lineHeight: 1.4,
  fontSize: "clamp(1.4rem, 2.4cqi, 2.6rem)", display: "inline",
  letterSpacing: "0.01em", marginRight: "0.25em",
  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  backgroundClip: "text",
};

const WORD_INACTIVE = {
  ...WORD_BASE, color: "rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.2)",
  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
};

const WORD_PAST = {
  ...WORD_BASE, color: "#fff",
  background: "#fff",
  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  textShadow: "0 0 14px rgba(255,255,255,0.35), 0 0 3px rgba(255,255,255,0.5)",
};

const WORD_ACTIVE_UNSUNG = {
  ...WORD_BASE, color: "rgba(255,255,255,0.5)",
  background: "rgba(255,255,255,0.5)",
  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
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
    return { parsed: r.data ? parseTTMLData(r.data) : null, artworkUrl: r.artworkUrl || null };
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

function getWordProgress(word, currentTime) {
  if (!word || currentTime == null) return null;
  const d = word.endTime - word.startTime;
  if (d <= 0) return null;
  return Math.max(0, Math.min(1, (currentTime - word.startTime) / d));
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

function LyricsView({ parsedLyrics, activeIndices, currentTime, rawClockPosRef, accent }) {
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

  useEffect(() => {
    if (!lines || lineCount === 0) return;
    let running = true;
    let lastTime = performance.now();
    let frameId;

    const tick = (now) => {
      if (!running) return;
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const curTime = rawClockPosRef?.current || currentTimeRef.current;
      const accentColor = accentRef.current || "#ffffff";
      const activeLineIdx = activeLine ?? -1;

      if (isUserScrollingRef.current !== wasUserScrollingRef.current) {
        wasUserScrollingRef.current = isUserScrollingRef.current;
        if (!isUserScrollingRef.current && scrollRef.current) {
          scrollSpringRef.current = new Spring(scrollRef.current.scrollTop, 3, 0.65);
          scrollSpringRef.current.SetGoal(targetScrollRef.current);
        }
      }
      if (!isUserScrollingRef.current && scrollRef.current) {
        const scrollPos = scrollSpringRef.current.Step(dt);
        if (Math.abs(scrollRef.current.scrollTop - scrollPos) > 0.3) {
          scrollRef.current.scrollTop = scrollPos;
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

        let opacityGoal = isLineActive ? (isBackground ? 0.75 : 1.0) : (li < activeLineIdx ? (isBackground ? 0.45 : Math.max(0.48, 0.88 - dist * 0.10)) : (isBackground ? 0.35 : Math.max(0.42, 0.75 - dist * 0.10)));

        lineSprings.opacity.SetGoal(opacityGoal);
        lineSprings.blur.SetGoal(isLineActive ? 0 : Math.min(6.25, dist * 1.25));

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
          if (wordState === "Active") {
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
          word.AnimatorStore.Scale.SetGoal(tScale);
          word.AnimatorStore.YOffset.SetGoal(tYOffset);
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
  }, [lines, lineCount, activeLine]);

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

          return (
            <div
              key={`line-${li}`}
              ref={(el) => registerLineRef(li, el)}
              className={`lyric-line ${isActiveLine ? "active" : ""} ${isBackground ? "background-vocal" : ""} ${isOpposite ? "opposite-aligned" : ""}`}
              onClick={() => { if (lineStartTime >= 0) window.electronAPI?.seekTo(lineStartTime); }}
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
          <div className="footer-provider">Provided by: Spicy Lyrics</div>
          <div className="footer-community">These lyrics have been provided by our community</div>
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
  const [artFloatY, setArtFloatY] = useState(0);

  const accentVelRef = useRef(0);
  const accentCurrentRef = useRef(null);
  const kawarpRef = useRef(null);
  const kawarpCanvasRef = useRef(null);
  const mountCount = useRef(0);
  const ipcCount = useRef(0);
  const renderCount = useRef(0);
  const lastTrackRef = useRef(null);
  const parsedLyricsRef = useRef(null);
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
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

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

  useEffect(() => {
    if (palette.length === 0) { setDisplayAccent(null); return; }
    const targetAccent = palette[0];
    const targetParts = (targetAccent.match(/[\d.]+/g) || []).map(Number);
    const targetH = targetParts[0] || 0;
    const targetS = targetParts[1] || 50;
    const targetL = targetParts[2] || 55;
    const spring = new Spring(targetH, 1.5, 0.8, targetH);
    let running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!running) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const h = spring.Step(dt);
      setDisplayAccent(`hsl(${Math.round(h)}, ${targetS}%, ${targetL}%)`);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { running = false; };
  }, [palette]);

  useEffect(() => {
    let cancelled = false;
    setKawarpReady(false);
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
          log("Kawarp: no source yet, deferring");
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
  }, [artworkUrl, palette]);

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

  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      setArtFloatY(Math.sin(performance.now() / 4000) * 6);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { running = false; };
  }, []);

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
      setArtworkUrl(r?.artworkUrl ?? null);
      setFetching(false);
    }).catch(() => setFetching(false));
  }, [state?.track?.nameCleaned, state?.track?.artistCleaned, state?.status]);

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
    try { if (!parsedLyrics?.lines) return { line: -1, word: -1 }; return getActiveIndices(parsedLyrics.lines, currentTime); }
    catch { return { line: -1, word: -1 }; }
  }, [parsedLyrics, currentTime]);

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
    <div style={CONTAINER}>
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
          <div style={LEFT_PANEL}>
            <div style={{ ...ART_PLACEHOLDER, transform: `translateY(${artFloatY}px)` }}>
              {artworkUrl
                ? <ArtworkImage url={artworkUrl} />
                : <div style={NOTE}>♪</div>}
            </div>
            {hasTrack && duration > 0 && <div style={PROGRESS_ROW}><div style={TIMESTAMP}>{formatTime(currentTime)}</div><div style={PROGRESS_BAR}><div style={PROGRESS_FILL(progressPct, displayAccent)} /></div><div style={TIMESTAMP}>{formatTime(duration)}</div></div>}
            <div style={SONG_TITLE}>{title || "No Track Playing"}</div>
            <div style={SONG_ARTIST}>{artist || "Apple Music"}</div>
            {showLoader && <div style={LOADER_BAR}><div style={{ width: "60%", height: "100%", background: "rgba(255,255,255,0.4)", borderRadius: 2, animation: "slide 1.2s ease-in-out infinite" }} /></div>}
          </div>
          <div style={{ flex: 1, height: "100vh", WebkitAppRegion: "no-drag" }}>
            {hasLyrics ? <LyricsView parsedLyrics={parsedLyrics} activeIndices={activeIndices} currentTime={currentTime} rawClockPosRef={rawClockPosRef} accent={displayAccent} />
            : <div style={FALLBACK}>{hasTrack ? <><div style={FALLBACK_TITLE}>{fallbackText}</div><div style={FALLBACK_SUB}>{title} — {artist}</div></> : <div style={FALLBACK_TITLE}>{message}</div>}</div>}
          </div>
        </div>
      )}
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
