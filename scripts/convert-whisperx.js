import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { customKey } from "../src/main/lyrics/customKey.js";

const args = process.argv.slice(2);
if (args.length < 3) {
  console.log("Usage: node scripts/convert-whisperx.js <whisperx-json-file> <Track Name> <Artist Name>");
  process.exit(1);
}

const [jsonPath, trackName, artistName] = args;

if (!fs.existsSync(jsonPath)) {
  console.error("Error: File not found:", jsonPath);
  process.exit(1);
}

const rawJson = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const segments = rawJson.segments || [];

function formatTTMLTime(seconds) {
  const s = parseFloat(seconds || 0);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = (s % 60).toFixed(3);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(6, "0")}`;
}

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

const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word" xml:lang="en">
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

const customDir = path.join(os.homedir(), ".sweetly-custom");
if (!fs.existsSync(customDir)) {
  fs.mkdirSync(customDir, { recursive: true });
}

const outPath = path.join(customDir, `${customKey(trackName, artistName)}.ttml`);

fs.writeFileSync(outPath, ttml, "utf8");
console.log("\n✅ SUCCESS! Converted WhisperX JSON -> Sweetly Word-Level TTML!");
console.log("📁 Saved to:", outPath);
console.log(`🎵 Sweetly will now auto-sync lyrics whenever "${trackName}" by "${artistName}" plays in Apple Music!\n`);
