import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const activeJobs = new Set();

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

  for (const seg of segments) {
    const words = seg.words || [];
    if (!words.length) continue;

    const segStart = formatTTMLTime(words[0].start ?? seg.start);
    const segEnd = formatTTMLTime(words[words.length - 1].end ?? seg.end);

    let spans = "";
    for (const w of words) {
      if (!w.word) continue;
      const wStart = formatTTMLTime(w.start ?? seg.start);
      const wEnd = formatTTMLTime(w.end ?? seg.end);
      const cleanWord = w.word.trim();
      spans += `  <span begin="${wStart}" end="${wEnd}">${cleanWord} </span>`;
    }

    paragraphs += `<p begin="${segStart}" end="${segEnd}">\n${spans}\n</p>\n`;
  }

  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word" xml:lang="en">
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

  console.log("[Sweetly-AutoAligner] Triggering background AI alignment for:", name, artist);

  const customDir = path.join(os.homedir(), ".sweetly-custom");
  if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });

  const safeName = `${name}_${artist}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const jsonPath = path.join(customDir, `${safeName}.json`);

  if (fs.existsSync(jsonPath)) {
    try {
      const rawJson = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const ttml = convertWhisperJsonToTTML(rawJson, artist);
      const ttmlPath = path.join(customDir, `${safeName}.ttml`);
      fs.writeFileSync(ttmlPath, ttml, "utf8");
      console.log("[Sweetly-AutoAligner] Automatically converted existing JSON to TTML:", ttmlPath);
      activeJobs.delete(jobKey);
      return;
    } catch {}
  }

  if (!audioPath) {
    console.log("[Sweetly-AutoAligner] Audio path required for auto-alignment");
    activeJobs.delete(jobKey);
    return;
  }

  const child = spawn("whisperx", [
    audioPath,
    "--model", "small",
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
        const ttmlPath = path.join(customDir, `${safeName}.ttml`);
        fs.writeFileSync(ttmlPath, ttml, "utf8");
        console.log("[Sweetly-AutoAligner] ✅ AI Alignment complete! Saved TTML to:", ttmlPath);
      } catch (e) {
        console.error("[Sweetly-AutoAligner] Error converting aligned JSON:", e.message);
      }
    }
  });

  child.on("error", (e) => {
    activeJobs.delete(jobKey);
    console.log("[Sweetly-AutoAligner] WhisperX spawn note:", e.message);
  });
}
