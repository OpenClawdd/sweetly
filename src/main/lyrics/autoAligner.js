/**
 * Background lyrics aligner.
 *
 * When a track has no word-level timings anywhere, capture the audio as it
 * plays and derive them. If we already know the words (Apple often ships
 * correct-but-untimed lyrics), the Python side force-aligns that text rather
 * than transcribing, which is both faster and immune to mishearing.
 *
 * Results land in ~/.sweetly-custom/<key>.ttml, which the custom source checks
 * first — so the next play of that track is word-level synced.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { customKey } from "./customKey.js";
import { findLoopbackDevice, captureSystemAudio, SETUP_HINT } from "./audioCapture.js";
import { parseTtmlXmlToJson } from "./ttmlXml.js";
import { lyricsCoverTrack } from "./utils.js";

const CUSTOM_DIR = path.join(os.homedir(), ".sweetly-custom");
const WORK_DIR = path.join(CUSTOM_DIR, ".work");

const activeJobs = new Map();
let onLyricsUpdatedCallback = null;
let onStatusCallback = null;
let warnedNoLoopback = false;

// Capturing makes sense when starting near the top of a track (within the first 30s)
const MAX_START_POSITION = 30;

export function setLyricsUpdatedListener(cb) {
  onLyricsUpdatedCallback = cb;
}

/**
 * Report job progress to the UI. Capture runs for the length of the track, so
 * without this the user has no idea anything is happening — and closing the
 * window kills the ffmpeg child mid-recording.
 */
export function setAlignStatusListener(cb) {
  onStatusCallback = cb;
}

function emitStatus(payload) {
  try { onStatusCallback?.(payload); } catch {}
}

export function getActiveJobs() {
  return [...activeJobs.keys()];
}

function pythonBin() {
  const candidates = [
    process.env.SWEETLY_PYTHON_BIN,
    path.join(os.homedir(), ".local/pipx/venvs/whisperx/bin/python"),
    "/opt/homebrew/bin/python3",
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || "python3";
}

function alignScript() {
  // scripts/ sits next to src/ in dev and is copied beside the bundle in prod.
  const candidates = [
    process.env.SWEETLY_ALIGN_SCRIPT,
    path.resolve(process.cwd(), "scripts/align_lyrics.py"),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../scripts/align_lyrics.py"),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function formatTTMLTime(seconds) {
  const s = Math.max(0, parseFloat(seconds || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = (s % 60).toFixed(3);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(6, "0")}`;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const INTERJECTIONS = /^\(?(boom[-]?boom|skrrt|yeah|yea|uh|uh-huh|woah|whoa|ay|aye|brrr|brrt|pew|pop|gang|bop|ha|haha|yah|yup|oh|hol'?\s*up|hold\s*up)\)?$/i;

/**
 * WhisperX/Qwen JSON -> Apple-shaped TTML.
 *
 * Parenthesised words and bare interjections become an x-bg sub-line so they
 * render stacked under the lead the way Music.app does.
 */
export function convertAlignedJsonToTTML(rawJson, artistName = "", offsetSeconds = 0) {
  const segments = rawJson.segments || [];
  let paragraphs = "";
  let lastEnd = 0;

  for (const seg of segments) {
    const words = seg.words || [];
    if (!words.length) continue;

    const shift = (v, fallback) => formatTTMLTime((v ?? fallback ?? 0) + offsetSeconds);
    const segStart = shift(words[0].start, seg.start);
    const segEnd = shift(words[words.length - 1].end, seg.end);
    lastEnd = Math.max(lastEnd, (words[words.length - 1].end ?? seg.end ?? 0) + offsetSeconds);

    let leadSpans = "";
    let bgSpans = "";

    // An interjection only counts as an ad-lib when it stands alone as its own
    // line. Testing every token meant ordinary lyrics containing "pop", "yeah"
    // or "gang" had that word pulled out of the lead and stacked underneath.
    const isLoneInterjection = words.length === 1;

    for (const w of words) {
      const raw = String(w.word || "").trim();
      if (!raw) continue;
      const clean = raw.replace(/[()]/g, "").trim();
      if (!clean) continue;

      const span = `<span begin="${shift(w.start, seg.start)}" end="${shift(w.end, seg.end)}">${escapeXml(clean)} </span>`;
      if (raw.startsWith("(") || (isLoneInterjection && INTERJECTIONS.test(raw))) bgSpans += span;
      else leadSpans += span;
    }

    if (!leadSpans && !bgSpans) continue;

    // A line that is nothing but ad-libs stays a lead line — there is no
    // lead for it to sit under.
    if (!leadSpans) {
      paragraphs += `<p begin="${segStart}" end="${segEnd}">${bgSpans}</p>\n`;
      continue;
    }

    const bg = bgSpans ? `<span ttm:role="x-bg">${bgSpans}</span>` : "";
    paragraphs += `<p begin="${segStart}" end="${segEnd}">${leadSpans}${bg}</p>\n`;
  }

  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word" xml:lang="en">
<head>
  <metadata>
    <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
      <songwriters><songwriter>${escapeXml(artistName)}</songwriter></songwriters>
    </iTunesMetadata>
  </metadata>
</head>
<body dur="${formatTTMLTime(lastEnd)}">
  <div>
${paragraphs}  </div>
</body>
</tt>`;
}

function runAligner({ audioPath, lyricsPath, anchorsPath, outPath }) {
  return new Promise((resolve) => {
    const script = alignScript();
    if (!script) {
      resolve({ ok: false, reason: "align_lyrics.py not found" });
      return;
    }

    const args = [script, "--audio", audioPath, "--out", outPath];
    if (lyricsPath) args.push("--lyrics", lyricsPath);
    if (anchorsPath) args.push("--anchors", anchorsPath);

    const child = spawn(pythonBin(), args, { env: { ...process.env, PYTHONWARNINGS: "ignore" } });
    let stderr = "";
    child.stderr.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      for (const line of text.split("\n")) {
        if (line.startsWith("[align]")) console.log("[Sweetly-Aligner]", line.trim());
      }
    });

    child.on("error", (e) => resolve({ ok: false, reason: `python spawn failed: ${e.message}` }));
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(outPath)) resolve({ ok: true });
      else resolve({ ok: false, reason: `aligner exited ${code}: ${stderr.trim().slice(-300)}` });
    });
  });
}

/**
 * Kick off alignment for a track. Safe to call on every fetch — it no-ops when
 * a result already exists, a job is already running, or preconditions fail.
 *
 * @param {object} opts
 * @param {string} opts.name         track title
 * @param {string} opts.artist       artist
 * @param {number} opts.duration     track length in seconds
 * @param {number} opts.position     current playhead in seconds
 * @param {string} [opts.lyricsText] known-but-untimed lyrics, enables forced alignment
 * @param {Array<{text: string, start: number, end: number}>} [opts.anchors]
 *        line-level time windows from a synced source, enables anchored alignment
 */
/**
 * Is the .ttml already on disk worth keeping?
 *
 * Existence alone is not the question. A collapsed alignment — every line
 * stamped into the opening seconds — is a well-formed file that renders
 * perfectly and is useless, and treating it as "done" made it permanent:
 * the aligner skipped the track, so replaying it could never produce a
 * better one. Judge the file by the same coverage guard the serving path
 * uses, so a bad result is simply redone on the next play.
 *
 * Anything unreadable counts as unusable — regenerating costs a few minutes,
 * whereas trusting a corrupt file costs the track.
 */
export function existingAlignmentIsUsable(ttmlPath, duration) {
  if (!fs.existsSync(ttmlPath)) return false;
  try {
    const parsed = parseTtmlXmlToJson(fs.readFileSync(ttmlPath, "utf8"));
    if (!parsed?.Content?.length) return false;
    return lyricsCoverTrack(parsed, duration);
  } catch {
    return false;
  }
}

export async function triggerAutoAlignment({ name, artist, duration, position = 0, lyricsText = "", anchors = [] }) {
  const key = customKey(name, artist);
  if (!key) return { started: false, reason: "no key" };
  if (activeJobs.has(key)) return { started: false, reason: "already running" };

  fs.mkdirSync(WORK_DIR, { recursive: true });
  const ttmlPath = path.join(CUSTOM_DIR, `${key}.ttml`);
  if (existingAlignmentIsUsable(ttmlPath, duration)) return { started: false, reason: "already aligned" };
  if (fs.existsSync(ttmlPath)) {
    console.log("[Sweetly-Aligner] Existing alignment is collapsed or unreadable, regenerating:", ttmlPath);
  }

  // Pre-aligned JSON dropped in by hand or by convert-whisperx.
  const jsonPath = path.join(CUSTOM_DIR, `${key}.json`);
  if (fs.existsSync(jsonPath)) {
    try {
      const ttml = convertAlignedJsonToTTML(JSON.parse(fs.readFileSync(jsonPath, "utf8")), artist);
      fs.writeFileSync(ttmlPath, ttml, "utf8");
      console.log("[Sweetly-Aligner] Converted existing JSON ->", ttmlPath);
      onLyricsUpdatedCallback?.(name, artist);
      return { started: false, reason: "converted existing json" };
    } catch (e) {
      console.log("[Sweetly-Aligner] Bad pre-aligned JSON:", e.message);
    }
  }

  if (!Number.isFinite(duration) || duration < 20) {
    return { started: false, reason: "unknown or too-short duration" };
  }
  if (position > MAX_START_POSITION) {
    // Mid-song: the recording would miss the opening lines, so the whole
    // lyric could not be aligned against it. Catch it on the next play.
    return { started: false, reason: `track already ${Math.round(position)}s in` };
  }

  const device = await findLoopbackDevice();
  if (!device) {
    if (!warnedNoLoopback) {
      warnedNoLoopback = true;
      console.log("[Sweetly-Aligner] No loopback audio device found.\n" + SETUP_HINT);
    }
    return { started: false, reason: "no loopback device" };
  }

  const controller = new AbortController();
  activeJobs.set(key, controller);

  const audioPath = path.join(WORK_DIR, `${key}.wav`);
  const outJson = path.join(WORK_DIR, `${key}.json`);
  const lyricsPath = lyricsText.trim() ? path.join(WORK_DIR, `${key}.txt`) : null;
  if (lyricsPath) fs.writeFileSync(lyricsPath, lyricsText, "utf8");

  // Line windows from a synced source. Their presence switches the aligner to
  // the anchored path, which cannot collapse.
  const anchorsPath = anchors?.length ? path.join(WORK_DIR, `${key}.anchors.json`) : null;
  if (anchorsPath) fs.writeFileSync(anchorsPath, JSON.stringify(anchors), "utf8");

  const seconds = Math.min(duration - position + 1, 600);
  console.log(
    `[Sweetly-Aligner] Capturing "${name}" from ${device.name} for ${Math.round(seconds)}s`,
    anchorsPath ? "(anchored)" : lyricsPath ? "(forced alignment)" : "(ASR)",
  );

  // Fire-and-forget: this runs for the length of the song.
  (async () => {
    try {
      emitStatus({ name, artist, phase: "capturing", seconds: Math.round(seconds) });
      const cap = await captureSystemAudio({
        seconds, outPath: audioPath, deviceIndex: device.index, signal: controller.signal,
      });
      if (!cap.ok) {
        console.log("[Sweetly-Aligner] Capture failed:", cap.reason);
        emitStatus({ name, artist, phase: "failed", reason: cap.reason });
        return;
      }

      emitStatus({ name, artist, phase: "aligning" });
      const aligned = await runAligner({ audioPath, lyricsPath, anchorsPath, outPath: outJson });
      if (!aligned.ok) {
        console.log("[Sweetly-Aligner] Alignment failed:", aligned.reason);
        emitStatus({ name, artist, phase: "failed", reason: aligned.reason });
        return;
      }

      const json = JSON.parse(fs.readFileSync(outJson, "utf8"));
      const ttml = convertAlignedJsonToTTML(json, artist, position);
      fs.writeFileSync(ttmlPath, ttml, "utf8");
      console.log("[Sweetly-Aligner] Aligned and saved ->", ttmlPath);
      emitStatus({ name, artist, phase: "done" });
      onLyricsUpdatedCallback?.(name, artist);
    } catch (e) {
      console.error("[Sweetly-Aligner] Job error:", e.message);
      emitStatus({ name, artist, phase: "failed", reason: e.message });
    } finally {
      activeJobs.delete(key);
      // SWEETLY_KEEP_CAPTURE=1 retains the wav/json/txt for debugging an
      // alignment without having to record the song again.
      if (process.env.SWEETLY_KEEP_CAPTURE === "1") {
        console.log("[Sweetly-Aligner] Keeping work files in", WORK_DIR);
      } else {
        for (const f of [audioPath, outJson, lyricsPath]) {
          if (f) try { fs.unlinkSync(f); } catch {}
        }
      }
    }
  })();

  return { started: true, seconds };
}

/** Stop an in-flight capture (e.g. the user skipped the track). */
export function cancelAlignment(name, artist) {
  const key = customKey(name, artist);
  const controller = activeJobs.get(key);
  if (!controller) return false;
  controller.abort();
  activeJobs.delete(key);
  console.log("[Sweetly-Aligner] Cancelled job for", key);
  emitStatus({ name, artist, phase: "cancelled" });
  return true;
}
