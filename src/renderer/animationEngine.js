/**
 * animationEngine.js — SpicyLyrics animation engine port for Sweetly
 * 
 * Ports cubic spline interpolation, all spline range tables, spring factory
 * functions, and animation constants from LyricsAnimator.ts + Shared.ts.
 */
import { Spring } from "../modules/Spring";

// ─── Cubic Spline Interpolator ───────────────────────────────────────────────
// Port of the cubic-spline npm package used by SpicyLyrics.
// Given sorted (x,y) data points, constructs natural cubic spline coefficients
// and evaluates at arbitrary x with clamped extrapolation.

class CubicSpline {
  constructor(xs, ys) {
    const n = xs.length - 1;
    if (n < 1) throw new Error("Need at least 2 points");
    this.xs = xs;
    this.ys = ys;
    // Compute natural cubic spline coefficients (a, b, c, d for each segment)
    const h = new Float64Array(n);
    const alpha = new Float64Array(n);
    for (let i = 0; i < n; i++) h[i] = xs[i + 1] - xs[i];
    for (let i = 1; i < n; i++) {
      alpha[i] = (3 / h[i]) * (ys[i + 1] - ys[i]) - (3 / h[i - 1]) * (ys[i] - ys[i - 1]);
    }
    const c = new Float64Array(n + 1);
    const l = new Float64Array(n + 1);
    const mu = new Float64Array(n + 1);
    const z = new Float64Array(n + 1);
    l[0] = 1;
    for (let i = 1; i < n; i++) {
      l[i] = 2 * (xs[i + 1] - xs[i - 1]) - h[i - 1] * mu[i - 1];
      mu[i] = h[i] / l[i];
      z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
    }
    l[n] = 1;
    for (let j = n - 1; j >= 0; j--) {
      c[j] = z[j] - mu[j] * c[j + 1];
    }
    this.a = new Float64Array(n);
    this.b = new Float64Array(n);
    this.c = c;
    this.d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.a[i] = ys[i];
      this.b[i] = (ys[i + 1] - ys[i]) / h[i] - h[i] * (c[i + 1] + 2 * c[i]) / 3;
      this.d[i] = (c[i + 1] - c[i]) / (3 * h[i]);
    }
    this.n = n;
  }

  at(x) {
    const { xs, n } = this;
    // Clamp to data range
    if (x <= xs[0]) return this.ys[0];
    if (x >= xs[n]) return this.ys[n];
    // Binary search for the right segment
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid + 1] < x) lo = mid + 1;
      else if (xs[mid] > x) hi = mid - 1;
      else { lo = mid; break; }
    }
    const i = lo;
    const dx = x - xs[i];
    return this.a[i] + this.b[i] * dx + this.c[i] * dx * dx + this.d[i] * dx * dx * dx;
  }
}

function makeSpline(points) {
  const xs = points.map(p => p.Time);
  const ys = points.map(p => p.Value);
  return new CubicSpline(xs, ys);
}

// ─── Shared Constants (from Shared.ts) ───────────────────────────────────────
export const IdleLyricsScale = 0.95;
export const BlurMultiplier = 1.25;

// ─── Word Animation Ranges & Splines ─────────────────────────────────────────
const ScaleRange = [
  { Time: 0, Value: 0.95 },
  { Time: 0.7, Value: 1.0505 },
  { Time: 1, Value: 1 },
];

const YOffsetRange = [
  { Time: 0, Value: 1 / 100 },   // 0.01 (slight push down)
  { Time: 0.9, Value: -(1 / 60) }, // -0.0167 (pop up)
  { Time: 1, Value: 0 },          // settle
];

const GlowRange = [
  { Time: 0, Value: 0 },
  { Time: 0.15, Value: 1 },
  { Time: 0.6, Value: 1 },
  { Time: 1, Value: 0 },
];

export const ScaleSpline = makeSpline(ScaleRange);
export const YOffsetSpline = makeSpline(YOffsetRange);
export const GlowSpline = makeSpline(GlowRange);

// Spring tuning constants for words
const YOffsetDamping = 0.4;
const YOffsetFrequency = 1.45;
const ScaleDamping = 0.64;
const ScaleFrequency = 0.88;
const GlowDamping = 0.56;
const GlowFrequency = 1.18;

// ─── Letter Animation Ranges & Splines ───────────────────────────────────────
const LetterScaleRange = [
  { Time: 0, Value: 0.95 },
  { Time: 0.7, Value: 1.175 },
  { Time: 1, Value: 1 },
];

const LetterYOffsetRange = [
  { Time: 0, Value: 1 / 100 },
  { Time: 0.9, Value: -(1 / 56) }, // -0.0179 (stronger pop)
  { Time: 1, Value: 0 },
];

export const LetterScaleSpline = makeSpline(LetterScaleRange);
export const LetterYOffsetSpline = makeSpline(LetterYOffsetRange);
// Letters reuse GlowSpline

export const LetterGlowMultiplier_Opacity = 185;
export const SungLetterGlow = 0.2;

// ─── Dot Animation Constants & Splines ───────────────────────────────────────
const DotScaleRange = [
  { Time: 0, Value: 0.75 },
  { Time: 0.7, Value: 1.05 },
  { Time: 1, Value: 1 },
];

const DotYOffsetRange = [
  { Time: 0, Value: 0 },
  { Time: 0.9, Value: -0.12 },
  { Time: 1, Value: 0 },
];

const DotGlowRange = [
  { Time: 0, Value: 0 },
  { Time: 0.6, Value: 1 },
  { Time: 1, Value: 1 },
];

const DotOpacityRange = [
  { Time: 0, Value: 0.35 },
  { Time: 0.6, Value: 1 },
  { Time: 1, Value: 1 },
];

export const DotScaleSpline = makeSpline(DotScaleRange);
export const DotYOffsetSpline = makeSpline(DotYOffsetRange);
export const DotGlowSpline = makeSpline(DotGlowRange);
export const DotOpacitySpline = makeSpline(DotOpacityRange);

const DotAnimations = {
  ScaleDamping: 0.6,
  ScaleFrequency: 0.7,
  YOffsetDamping: 0.4,
  YOffsetFrequency: 1.25,
  GlowDamping: 0.5,
  GlowFrequency: 1,
  OpacityDamping: 0.5,
  OpacityFrequency: 1,
};

// ─── Line Glow ───────────────────────────────────────────────────────────────
const LineGlowRange = [
  { Time: 0, Value: 0 },
  { Time: 0.5, Value: 1 },
  { Time: 1, Value: 0 },
];
export const LineGlowSpline = makeSpline(LineGlowRange);
const LineGlowDamping = 0.5;
const LineGlowFrequency = 1;

// ─── CSS Variable Constants ──────────────────────────────────────────────────
// Opacity tiers for line states (from Mixed.css)
export const VOCAL_OPACITY = {
  NotSung: 0.51,
  Active: 1,
  Sung: 0.497,
};

// ─── Spring Factory Functions ────────────────────────────────────────────────
export function createWordSprings() {
  return {
    Scale: new Spring(ScaleSpline.at(0), ScaleFrequency, ScaleDamping),
    YOffset: new Spring(YOffsetSpline.at(0), YOffsetFrequency, YOffsetDamping),
    Glow: new Spring(GlowSpline.at(0), GlowFrequency, GlowDamping),
  };
}

export function createLetterSprings() {
  return {
    Scale: new Spring(LetterScaleSpline.at(0), ScaleFrequency, ScaleDamping),
    YOffset: new Spring(LetterYOffsetSpline.at(0), YOffsetFrequency, YOffsetDamping),
    Glow: new Spring(GlowSpline.at(0), GlowFrequency, GlowDamping),
  };
}

export function createDotSprings() {
  return {
    Scale: new Spring(DotScaleSpline.at(0), DotAnimations.ScaleFrequency, DotAnimations.ScaleDamping),
    YOffset: new Spring(DotYOffsetSpline.at(0), DotAnimations.YOffsetFrequency, DotAnimations.YOffsetDamping),
    Glow: new Spring(DotGlowSpline.at(0), DotAnimations.GlowFrequency, DotAnimations.GlowDamping),
    Opacity: new Spring(DotOpacitySpline.at(0), DotAnimations.OpacityFrequency, DotAnimations.OpacityDamping),
  };
}

export function createLineSprings() {
  return {
    Glow: new Spring(LineGlowSpline.at(0), LineGlowFrequency, LineGlowDamping),
  };
}

// ─── Utility Functions ───────────────────────────────────────────────────────
export function getElementState(currentTime, startTime, endTime) {
  if (currentTime < startTime) return "NotSung";
  if (currentTime >= endTime) return "Sung";
  return "Active";
}

export function getProgressPercentage(currentTime, startTime, endTime) {
  if (currentTime <= startTime) return 0;
  if (currentTime >= endTime) return 1;
  return (currentTime - startTime) / (endTime - startTime);
}

// easeSinOut from d3-ease
export function easeSinOut(t) {
  return Math.sin(t * Math.PI / 2);
}

// Letter capability check (from IsLetterCapable.ts)
// A word is letter-capable if total duration >= 1000ms and text length <= 12
export function isLetterCapable(textLength, totalDurationMs) {
  if (textLength > 12) return false;
  return totalDurationMs >= 1000;
}

// ─── Style Cache (batch DOM writes for performance) ──────────────────────────
const _styleCache = new WeakMap();
const _styleQueue = new Map();

export function setStyleIfChanged(el, prop, value, epsilon = 0) {
  if (!el) return;
  let map = _styleCache.get(el);
  if (!map) {
    map = new Map();
    _styleCache.set(el, map);
  }
  const prev = map.get(prop);
  if (prev !== undefined) {
    const a = parseFloat(prev);
    const b = parseFloat(value);
    if (!isNaN(a) && !isNaN(b)) {
      if (Math.abs(a - b) <= epsilon) return;
    } else {
      if (prev === value) return;
    }
  }
  queueStyle(el, prop, value);
  map.set(prop, value);
}

// Note: _styleQueue entries are Maps, ensure the set works correctly
// Fix the queue setter:
export function queueStyle(el, prop, value) {
  if (!el) return;
  let props = _styleQueue.get(el);
  if (!props) {
    props = new Map();
    _styleQueue.set(el, props);
  }
  props.set(prop, value);
}

export function flushStyleBatch() {
  if (_styleQueue.size === 0) return;
  for (const [el, props] of _styleQueue) {
    for (const [prop, value] of props) {
      el.style.setProperty(prop, value);
    }
  }
  _styleQueue.clear();
}
