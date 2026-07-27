import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const activeJobs = new Set();
let onLyricsUpdatedCallback = null;

export function setLyricsUpdatedListener(cb) {
  onLyricsUpdatedCallback = cb;
}

function formatTTMLTime(seconds) {
  const s = parseFloat(seconds || 0);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = (s % 60).toFixed(3);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(6, "0")}`;
}

export function convertWhisperJsonToTTML(rawJson, artistName = "") {
  const segments = rawJson.segments || [];
  let paragraphs = "";

  const INTERJECTIONS = /^\(?(boom[-]?boom|slop|slap|skrrt|yeah|yea|uh|uh-huh|woah|whoa|ay|aye|brrr|brrt|pew|pop|bitch|gang|bop|ha|haha|flex|blat|slatt|yah|yup|oh|no|wait|look|say|hol'?\s*up|hold\s*up|go)\)?$/i;

  for (const seg of segments) {
    const words = seg.words || [];
    if (!words.length) continue;

    const segStart = formatTTMLTime(words[0].start ?? seg.start);
    const segEnd = formatTTMLTime(words[words.length - 1].end ?? seg.end);

    let mainSpans = "";
    let bgSpans = "";

    for (const w of words) {
      if (!w.word) continue;
      const wStart = formatTTMLTime(w.start ?? seg.start);
      const wEnd = formatTTMLTime(w.end ?? seg.end);
      const rawWord = w.word.trim();

      const isAdlib = rawWord.startsWith("(") || INTERJECTIONS.test(rawWord);
      const cleanWord = rawWord.replace(/[\(\)]/g, "").trim();

      if (!cleanWord) continue;

      if (isAdlib) {
        bgSpans += `  <span begin="${wStart}" end="${wEnd}">${cleanWord} </span>`;
      } else {
        mainSpans += `  <span begin="${wStart}" end="${wEnd}">${cleanWord} </span>`;
      }
    }

    if (mainSpans) {
      paragraphs += `<p begin="${segStart}" end="${segEnd}">\n${mainSpans}\n</p>\n`;
    }
    if (bgSpans) {
      paragraphs += `<p begin="${segStart}" end="${segEnd}" ttm:role="Background">\n${bgSpans}\n</p>\n`;
    }
  }

  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word" xml:lang="en">
<head>
  <metadata>
    <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
      <songwriters><songwriter>${artistName}</songwriter></songwriters>
    </iTunesMetadata>
  </metadata>
</head>
<body dur="${formatTTMLTime(segments[segments.length - 1]?.end || 180)}">
  <div>
${paragraphs}
  </div>
</body>
</tt>`;
}

export function triggerAutoAlignment(name, artist, audioPath = null) {
  const jobKey = `${name}|||${artist}`;
  if (activeJobs.has(jobKey)) return;
  activeJobs.add(jobKey);

  console.log("[Sweetly-AutoAligner] M5 Background AI Aligner triggered for:", name, artist);

  const customDir = path.join(os.homedir(), ".sweetly-custom");
  if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });

  const safeName = `${name}_${artist}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const jsonPath = path.join(customDir, `${safeName}.json`);
  const ttmlPath = path.join(customDir, `${safeName}.ttml`);

  if (fs.existsSync(jsonPath)) {
    try {
      const rawJson = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const ttml = convertWhisperJsonToTTML(rawJson, artist);
      fs.writeFileSync(ttmlPath, ttml, "utf8");
      console.log("[Sweetly-AutoAligner] Converted existing JSON to M5 TTML:", ttmlPath);
      activeJobs.delete(jobKey);
      onLyricsUpdatedCallback?.(name, artist);
      return;
    } catch {}
  }

  if (!audioPath) {
    console.log("[Sweetly-AutoAligner] Waiting for audio input file for background M5 alignment...");
    activeJobs.delete(jobKey);
    return;
  }

  const whisperBin = fs.existsSync("/Users/noahmendieta/.local/bin/whisperx")
    ? "/Users/noahmendieta/.local/bin/whisperx"
    : "whisperx";

  console.log("[Sweetly-AutoAligner] Spawning M5 GPU Metal Accelerated WhisperX:", whisperBin);

  const child = spawn(whisperBin, [
    audioPath,
    "--model", "small",
    "--device", "mps",
    "--compute_type", "float16",
    "--language", "en",
    "--output_format", "json",
    "--output_dir", customDir
  ]);

  child.on("close", (code) => {
    activeJobs.delete(jobKey);
    if (code === 0 && fs.existsSync(jsonPath)) {
      try {
        const rawJson = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        const ttml = convertWhisperJsonToTTML(rawJson, artist);
        fs.writeFileSync(ttmlPath, ttml, "utf8");
        console.log("[Sweetly-AutoAligner] ✅ M5 Metal GPU Alignment Complete! Saved to:", ttmlPath);
        onLyricsUpdatedCallback?.(name, artist);
      } catch (e) {
        console.error("[Sweetly-AutoAligner] Error converting aligned JSON:", e.message);
      }
    }
  });

  child.on("error", (e) => {
    activeJobs.delete(jobKey);
    console.log("[Sweetly-AutoAligner] WhisperX M5 spawn note:", e.message);
  });
}
