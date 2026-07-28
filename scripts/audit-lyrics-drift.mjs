#!/usr/bin/env node
/**
 * Audit ~/.sweetly-custom for *mistimed* alignments.
 *
 * `lyricsCoverTrack` only proves a file spans the track at a physically
 * possible rate. It is blind to drift: holding_slayr.ttml passed it at
 * 3.1 words/sec while sitting 14 seconds ahead of the vocal. Every file made
 * before anchored alignment landed is suspect for the same reason — the old
 * unanchored walker accumulated error across the song.
 *
 * Method: compare each file's line start times against a synced reference
 * (LRCLIB, falling back to Apple's line-level TTML).
 *
 * The honest caveat, enforced here rather than left to the reader: comparing
 * line n to line n only means anything when both sides segment the song the
 * same way. A file with 179 lines against a 105-line reference is comparing
 * unrelated lines, and its "drift" is noise. Those are reported INCONCLUSIVE
 * instead of being given a number that looks authoritative.
 *
 *   npm run audit-lyrics
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(HERE, "..", "src", "main");

const { parseTtmlXmlToJson } = await import(path.join(MAIN, "lyrics/ttmlXml.js"));
const { fetchLRCLib } = await import(path.join(MAIN, "lyrics/sources/lrclib.js"));
const { findAppleMusicLyrics } = await import(path.join(MAIN, "appleMusicApi.js"));
const { toLineAnchors } = await import(path.join(MAIN, "lyrics/utils.js"));

const CUSTOM_DIR = path.join(os.homedir(), ".sweetly-custom");
/** Seconds of median offset beyond which a file is worth regenerating. */
const DRIFT_THRESHOLD = 5;
/** Max fractional difference in line count before positional comparison is meaningless. */
const SEGMENTATION_TOLERANCE = 0.1;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** "hard_knock_slayr" -> { name: "hard knock", artist: "slayr" } is ambiguous, so
 *  the caller supplies real metadata; without it we can only skip. */
function loadMap() {
  const mapPath = path.join(CUSTOM_DIR, "audit-map.json");
  if (!fs.existsSync(mapPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(mapPath, "utf8"));
  } catch {
    return null;
  }
}

async function reference(name, artist, album) {
  try {
    const lrc = await fetchLRCLib(name, artist);
    const anchors = lrc ? toLineAnchors(lrc) : [];
    if (anchors.length) return { anchors, source: "lrclib" };
  } catch {}
  try {
    const apple = (await findAppleMusicLyrics(name, artist, album ?? ""))?.lyrics;
    const anchors = apple ? toLineAnchors(apple) : [];
    if (anchors.length) return { anchors, source: "apple" };
  } catch {}
  return null;
}

const map = loadMap();
if (!map) {
  console.error(
    `No ${path.join(CUSTOM_DIR, "audit-map.json")}.\n` +
      `Create it as { "<slug>": { "name": "...", "artist": "...", "album": "..." } }\n` +
      `— filename slugs cannot be reversed into a title and artist reliably.`,
  );
  process.exit(1);
}

const rows = [];
for (const [slug, meta] of Object.entries(map)) {
  const file = path.join(CUSTOM_DIR, `${slug}.ttml`);
  if (!fs.existsSync(file)) continue;

  let mine;
  try {
    mine = toLineAnchors(parseTtmlXmlToJson(fs.readFileSync(file, "utf8")));
  } catch {
    rows.push({ slug, verdict: "UNREADABLE" });
    continue;
  }
  if (!mine.length) {
    rows.push({ slug, verdict: "NO LINES" });
    continue;
  }

  const ref = await reference(meta.name, meta.artist, meta.album);
  if (!ref) {
    rows.push({ slug, lines: mine.length, verdict: "NO REFERENCE" });
    continue;
  }

  const spread = Math.abs(mine.length - ref.anchors.length) / Math.max(mine.length, ref.anchors.length);
  if (spread > SEGMENTATION_TOLERANCE) {
    rows.push({
      slug, lines: mine.length, refLines: ref.anchors.length, src: ref.source,
      verdict: "INCONCLUSIVE (segmentation differs)",
    });
    continue;
  }

  const n = Math.min(mine.length, ref.anchors.length);
  const deltas = Array.from({ length: n }, (_, i) => mine[i].start - ref.anchors[i].start);
  const drift = median(deltas);

  rows.push({
    slug, lines: mine.length, refLines: ref.anchors.length, src: ref.source,
    drift, verdict: Math.abs(drift) > DRIFT_THRESHOLD ? "DRIFTED" : "ok",
  });
}

console.log("file".padEnd(44), "lines".padStart(5), "ref".padStart(5), "src".padEnd(7), "drift".padStart(8), "verdict");
for (const r of rows.sort((a, b) => Math.abs(b.drift ?? 0) - Math.abs(a.drift ?? 0))) {
  console.log(
    r.slug.padEnd(44),
    String(r.lines ?? "-").padStart(5),
    String(r.refLines ?? "-").padStart(5),
    String(r.src ?? "-").padEnd(7),
    (r.drift === undefined ? "-" : `${r.drift >= 0 ? "+" : ""}${r.drift.toFixed(1)}s`).padStart(8),
    r.verdict,
  );
}

const drifted = rows.filter((r) => r.verdict === "DRIFTED");
console.log(`\n${drifted.length} drifted, ${rows.filter((r) => r.verdict === "ok").length} ok, ` +
  `${rows.filter((r) => String(r.verdict).startsWith("INCONCLUSIVE")).length} inconclusive.`);
if (drifted.length) {
  console.log("\nTo regenerate, move them aside — the aligner rebuilds a file it cannot find:");
  for (const r of drifted) console.log(`  mv ~/.sweetly-custom/${r.slug}.ttml ~/.sweetly-custom/.quarantine/`);
}
