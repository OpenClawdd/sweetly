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

function sanitizeFilename(str) {
  return str.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

export function getCustomLyrics(name, artist) {
  ensureCustomDir();
  const safeName = sanitizeFilename(`${name}_${artist}`);
  const filePath = path.join(CUSTOM_DIR, `${safeName}.ttml`);

  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      console.log("[Sweetly-Main] Loaded custom local TTML from disk:", filePath);
      return content;
    } catch (e) {
      console.log("[Sweetly-Main] Error reading custom TTML:", e.message);
    }
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
