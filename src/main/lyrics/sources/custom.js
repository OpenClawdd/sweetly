import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CUSTOM_DIR = path.join(os.homedir(), ".sweetly-custom");

function ensureCustomDir() {
  if (!fs.existsSync(CUSTOM_DIR)) {
    try {
      fs.mkdirSync(CUSTOM_DIR, { recursive: true });
    } catch {}
  }
}

export function getCustomLyrics(name, artist) {
  ensureCustomDir();
  if (!name) return null;

  const cleanName = name.replace(/\s*\([^)]*\)/g, "").replace(/\s*\[[^\]]*\]/g, "").trim();
  const cleanArtist = (artist || "").replace(/\s*\([^)]*\)/g, "").trim();

  const candidates = [
    sanitizeFilename(`${name}_${artist}`),
    sanitizeFilename(`${cleanName}_${cleanArtist}`),
    sanitizeFilename(name),
    sanitizeFilename(cleanName),
  ];

  try {
    const files = fs.readdirSync(CUSTOM_DIR);
    for (const cand of candidates) {
      if (!cand) continue;
      const matchedFile = files.find((f) => {
        const base = f.replace(/\.ttml$/i, "").replace(/\.json$/i, "");
        return base === cand || base.replace(/_+/g, "_") === cand.replace(/_+/g, "_");
      });

      if (matchedFile) {
        const filePath = path.join(CUSTOM_DIR, matchedFile);
        const content = fs.readFileSync(filePath, "utf8");
        console.log("[Sweetly-Main] Loaded custom local TTML from disk:", filePath);
        return content;
      }
    }
  } catch (e) {
    console.log("[Sweetly-Main] Error scanning custom TTML dir:", e.message);
  }
  return null;
}

export function saveCustomLyrics(name, artist, ttml) {
  ensureCustomDir();
  const safeName = sanitizeFilename(`${name}_${artist}`);
  const filePath = path.join(CUSTOM_DIR, `${safeName}.ttml`);

  try {
    fs.writeFileSync(filePath, ttml, "utf8");
    console.log("[Sweetly-Main] Saved custom TTML to disk:", filePath);
    return true;
  } catch (e) {
    console.log("[Sweetly-Main] Error saving custom TTML:", e.message);
    return false;
  }
}
