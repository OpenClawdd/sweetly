import { writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const SCRIPT = `tell application "System Events"
  if not (exists process "Music") then return "closed||||||||"
end tell

tell application "Music"
  try
    set pState to player state as string
    if pState is "playing" or pState is "paused" then
      set tName to ""
      set tArtist to ""
      set tAlbum to ""
      set tPos to 0
      set tDur to 0
      set tShuffle to "false"
      set tRepeat to "off"
      set tFav to "false"
      set tHasArt to "false"
      try
        set tName to name of current track
        set tArtist to artist of current track
        set tAlbum to album of current track
        set tPos to player position
        set tDur to duration of current track
      end try
      try
        set tShuffle to (shuffle enabled) as string
      end try
      try
        set tRepeat to (song repeat) as string
      end try
      try
        set tFav to (favorited of current track) as string
      end try
      try
        if (count of artworks of current track) > 0 then set tHasArt to "true"
      end try
      return pState & "|||" & tName & "|||" & tArtist & "|||" & tAlbum & "|||" & tPos & "|||" & tDur & "|||" & tShuffle & "|||" & tRepeat & "|||" & tFav & "|||" & tHasArt
    else
      return "stopped||||||||"
    end if
  on error
    return "closed||||||||"
  end try
end tell`;

const SCRIPT_PATH = path.join(tmpdir(), "sweetly-music.scpt");
const ARTWORK_PATH = path.join(tmpdir(), "sweetly-current-artwork.png");

let lastExportedKey = null;
let cachedArtworkUrl = null;
let exportPromise = null;

export async function exportCurrentArtwork(trackKey) {
  if (!trackKey) return null;
  if (trackKey === lastExportedKey && cachedArtworkUrl) {
    return cachedArtworkUrl;
  }
  if (exportPromise && trackKey === lastExportedKey) {
    return exportPromise;
  }

  lastExportedKey = trackKey;
  exportPromise = (async () => {
    const exportScript = `tell application "Music"
      try
        if (count of artworks of current track) > 0 then
          set artData to raw data of artwork 1 of current track
          set filePath to "${ARTWORK_PATH}"
          set fileRef to open for access file filePath with write permission
          set eof fileRef to 0
          write artData to fileRef
          close access fileRef
          return filePath
        end if
      end try
      return ""
    end tell`;

    try {
      const { stdout } = await execFileAsync("osascript", ["-e", exportScript], {
        encoding: "utf8",
        timeout: 3000,
      });
      const outPath = stdout.trim();
      if (outPath) {
        try {
          const fileBuf = await readFile(ARTWORK_PATH);
          if (fileBuf && fileBuf.length > 0) {
            cachedArtworkUrl = `data:image/png;base64,${fileBuf.toString("base64")}`;
            return cachedArtworkUrl;
          }
        } catch (readErr) {
          console.error("[AppleScript] Failed to read exported artwork file:", readErr.message);
        }
      }
    } catch (e) {
      console.error("[AppleScript] exportCurrentArtwork failed:", e.message);
    }
    return null;
  })();

  return exportPromise;
}

export function cleanTrackTitle(title) {
  if (!title) return "";

  let cleaned = title
    .replace(/\*\*/g, "u")
    .replace(/f\*ck/gi, "fuck")
    .replace(/sh\*t/gi, "shit")
    .replace(/b\*tch/gi, "bitch")
    .replace(/\s*\(feat\.?\s+[^)]+\)/gi, "")
    .replace(/\s*\[feat\.?\s+[^\]]+\]/gi, "")
    .replace(/\s*\(ft\.?\s+[^)]+\)/gi, "")
    .replace(/\s*\[ft\.?\s+[^\]]+\]/gi, "")
    .replace(/\s*\(with\s+[^)]+\)/gi, "")
    .replace(/\s*\[with\s+[^\]]+\]/gi, "")
    .replace(/\s*\(Deluxe[^)]*\)/gi, "")
    .replace(/\s*\[Deluxe[^\]]*\]/gi, "")
    .replace(/\s*\(Remastered[^)]*\)/gi, "")
    .replace(/\s*\[Remastered[^\]]*\]/gi, "")
    .replace(/\s*\(Expanded[^)]*\)/gi, "")
    .replace(/\s*\[Expanded[^\]]*\]/gi, "")
    .replace(/\s*\(Album Version\)/gi, "")
    .replace(/\s*\[Album Version\]/gi, "")
    .replace(/\s*\(Single[^)]*\)/gi, "")
    .replace(/\s*\[Single[^\]]*\]/gi, "")
    .replace(/\s+-\s+Single\s*$/gi, "")
    .trim();

  return cleaned || title.trim();
}

export function cleanArtistName(artist) {
  if (!artist) return "";
  // Strip trailing qualifiers only: "(feat. X)", "[Live]", " - Topic".
  // The dash form requires surrounding whitespace so hyphenated names
  // survive intact — "a-ha", "Jay-Z" and "Blink-182" are artists, not
  // artists with suffixes.
  const cleaned = artist
    .replace(/\s*[([][^)\]]*[)\]]\s*$/g, "")
    .replace(/\s+[—–-]\s+.*$/, "")
    .trim();
  return cleaned || artist.trim();
}

export async function fetchAppleMusicState() {
  try {
    await writeFile(SCRIPT_PATH, SCRIPT, "utf8");

    const { stdout, stderr } = await execFileAsync("osascript", [SCRIPT_PATH], {
      encoding: "utf8",
      timeout: 5000,
    });

    if (stderr && stderr.trim()) {
      const msg = stderr.trim();
      if (!msg.includes("Can't get current track") && !msg.includes("Application isn't running")) {
        console.error("[osascript stderr]:", msg);
      }
    }

    const out = stdout.trim();
    const parts = out.split("|||");
    const status = parts[0] || "closed";

    if (status !== "playing" && status !== "paused") {
      return { status, track: null };
    }

    const rawName = parts[1] || "Unknown Track";
    const rawArtist = parts[2] || "Unknown Artist";
    const rawAlbum = parts[3] || "";
    const hasArt = parts[9] === "true";

    const nameCleaned = cleanTrackTitle(rawName);
    const artistCleaned = cleanArtistName(rawArtist);
    const trackKey = `${nameCleaned}|||${artistCleaned}|||${rawAlbum}`;

    let artworkUrl = null;
    if (hasArt) {
      artworkUrl = await exportCurrentArtwork(trackKey);
    }

    return {
      status,
      track: {
        name: rawName,
        nameCleaned,
        artist: rawArtist,
        artistCleaned,
        album: rawAlbum,
        position: parseFloat(parts[4]) || 0,
        duration: parseFloat(parts[5]) || 0,
        artworkUrl,
      },
      shuffle: parts[6] === "true",
      repeat: parts[7] || "off",
      favorited: parts[8] === "true",
    };
  } catch (err) {
    const detail = err.stderr || err.message || String(err);
    if (
      !detail.includes("Can't get current track") &&
      !detail.includes("Application isn't running")
    ) {
      console.error("[AppleScript error]:", String(detail).split("\n")[0]);
    }
    return { status: "closed", track: null };
  }
}

const AUTOMIX_THRESHOLD = 5;

export function isAutomixLikely(position, duration, threshold = AUTOMIX_THRESHOLD) {
  return duration > 0 && position > 0 && position >= duration - threshold;
}

export function pollAppleMusic(intervalMs, onState, getNextInterval) {
  let stopped = false;
  let timer;

  const tick = async () => {
    if (stopped) return;
    let state = { status: "closed", track: null };
    try {
      state = await fetchAppleMusicState();
      onState(state);
    } catch (err) {
      console.error("[Sweetly-Main] poll error:", err);
    }
    if (stopped) return;
    const next = getNextInterval ? getNextInterval(state) : intervalMs;
    timer = setTimeout(tick, next);
  };

  timer = setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/**
 * Run a short control script via `osascript -e`.
 *
 * These deliberately do NOT go through SCRIPT_PATH: the poller rewrites that
 * file every tick, so a control action landing between the poller's write and
 * its exec used to make one of the two run the other's script.
 */
async function runControl(label, script) {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      encoding: "utf8",
      timeout: 5000,
    });
    console.log("[AppleScript]", label);
    return stdout.trim();
  } catch (e) {
    console.error(`[AppleScript] ${label} failed:`, e.message);
    return null;
  }
}

export async function setPlayerPosition(seconds) {
  const pos = Number(seconds);
  if (!Number.isFinite(pos) || pos < 0) return false;
  return (
    (await runControl(
      `Set position: ${pos}`,
      `tell application "Music" to set player position to ${pos}`
    )) !== null
  );
}

export async function togglePlayPause() {
  return (await runControl("Toggle play/pause", `tell application "Music" to playpause`)) !== null;
}

export async function skipToNext() {
  return (await runControl("Next track", `tell application "Music" to next track`)) !== null;
}

export async function skipToPrevious() {
  return (
    (await runControl("Previous track", `tell application "Music" to previous track`)) !== null
  );
}

export async function toggleShuffle() {
  const out = await runControl(
    "Toggle shuffle",
    `tell application "Music"
      set shuffle enabled to not (shuffle enabled)
      return (shuffle enabled) as string
    end tell`
  );
  return out === "true";
}

/** Cycles off -> all -> one -> off, matching the Music.app repeat button. */
export async function cycleRepeat() {
  const out = await runControl(
    "Cycle repeat",
    `tell application "Music"
      if song repeat is off then
        set song repeat to all
      else if song repeat is all then
        set song repeat to one
      else
        set song repeat to off
      end if
      return (song repeat) as string
    end tell`
  );
  return out || "off";
}

export async function toggleFavorite() {
  const out = await runControl(
    "Toggle favorite",
    `tell application "Music"
      set favorited of current track to not (favorited of current track)
      return (favorited of current track) as string
    end tell`
  );
  return out === "true";
}
