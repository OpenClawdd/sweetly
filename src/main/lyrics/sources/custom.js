import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { customKey, customKeyCandidates, stripLyricsExt, slugify } from "../customKey.js";
import { parseTtmlXmlToJson } from "../ttmlXml.js";
import { lyricsCoverTrack } from "../utils.js";

const CUSTOM_DIR = path.join(os.homedir(), ".sweetly-custom");

function ensureCustomDir() {
  if (!fs.existsSync(CUSTOM_DIR)) {
    try {
      fs.mkdirSync(CUSTOM_DIR, { recursive: true });
    } catch {}
  }
}

function listCustomFiles() {
  try {
    return fs.readdirSync(CUSTOM_DIR).filter((f) => /\.ttml$/i.test(f));
  } catch {
    return [];
  }
}

/**
 * Last-resort match for near-miss filenames (punctuation drift, a missing
 * "feat." clause, a truncated artist). Requires every token of the shorter
 * side to appear in the longer one, so "in_da_club_50_cent" still matches
 * "in_da_club_50_cent_g_unit" but never matches an unrelated track.
 */
function fuzzyMatch(files, candidates) {
  for (const cand of candidates) {
    const candTokens = cand.split("_").filter(Boolean);
    if (candTokens.length < 2) continue;

    for (const file of files) {
      const base = slugify(stripLyricsExt(file));
      const baseTokens = new Set(base.split("_").filter(Boolean));
      if (candTokens.every((t) => baseTokens.has(t))) return file;
    }
  }
  return null;
}

export function getCustomLyrics(name, artist, trackDuration, opts = {}) {
  if (!name) return null;
  ensureCustomDir();

  const files = listCustomFiles();
  if (files.length === 0) return null;

  const candidates = customKeyCandidates(name, artist);
  const byKey = new Map();
  for (const file of files) {
    const key = slugify(stripLyricsExt(file));
    if (!byKey.has(key)) byKey.set(key, file);
  }

  let matched = null;
  for (const cand of candidates) {
    const slug = slugify(cand);
    if (byKey.has(slug)) {
      matched = byKey.get(slug);
      break;
    }
  }
  if (!matched) matched = fuzzyMatch(files, candidates);
  if (!matched) return null;

  try {
    const filePath = path.join(CUSTOM_DIR, matched);
    const content = fs.readFileSync(filePath, "utf8");

    // Files on disk are TTML XML, but the renderer's parser consumes the
    // spicylyrics {Content:[...]} shape. Returning the raw XML meant custom
    // lyrics always parsed to zero lines.
    const parsed = parseTtmlXmlToJson(content, opts);
    if (!parsed?.Content?.length) {
      console.log("[Sweetly-Main] Custom TTML parsed to no lines:", filePath);
      return null;
    }
    // A collapsed alignment parses and renders perfectly — it just flashes the
    // whole song past in a few seconds. Treat it as absent so the pipeline
    // falls through to a source that still has usable timings.
    if (!lyricsCoverTrack(parsed, trackDuration)) {
      console.log(
        "[Sweetly-Main] Custom TTML timings collapsed, quarantining file:",
        filePath,
        `(lines end well before ${Math.round(trackDuration)}s track)`,
      );
      try {
        fs.renameSync(filePath, filePath + ".bad");
      } catch {}
      return null;
    }

    console.log("[Sweetly-Main] Loaded custom local TTML from disk:", filePath, `(${parsed.Content.length} lines)`);
    return parsed;
  } catch (e) {
    console.log("[Sweetly-Main] Error reading custom TTML:", e.message);
    return null;
  }
}

export function saveCustomLyrics(name, artist, ttml) {
  ensureCustomDir();
  const key = customKey(name, artist);
  if (!key) return false;
  const filePath = path.join(CUSTOM_DIR, `${key}.ttml`);

  try {
    fs.writeFileSync(filePath, ttml, "utf8");
    console.log("[Sweetly-Main] Saved custom TTML to disk:", filePath);
    return true;
  } catch (e) {
    console.log("[Sweetly-Main] Error saving custom TTML:", e.message);
    return false;
  }
}
