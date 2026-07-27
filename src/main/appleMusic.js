import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const SCRIPT = `tell application "System Events"
  if not (exists process "Music") then return "closed||||||"
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
      try
        set tName to name of current track
        set tArtist to artist of current track
        set tAlbum to album of current track
        set tPos to player position
        set tDur to duration of current track
      end try
      return pState & "|||" & tName & "|||" & tArtist & "|||" & tAlbum & "|||" & tPos & "|||" & tDur
    else
      return "stopped||||||"
    end if
  on error
    return "closed||||||"
  end try
end tell`;

const SCRIPT_PATH = path.join(tmpdir(), "sweetly-music.scpt");

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
  const cleaned = artist.split(/[—\-\(\[][^\)\]—\-]*$/)[0].trim();
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

    return {
      status,
      track: {
        name: rawName,
        nameCleaned: cleanTrackTitle(rawName),
        artist: rawArtist,
        artistCleaned: cleanArtistName(rawArtist),
        album: parts[3] || "",
        position: parseFloat(parts[4]) || 0,
        duration: parseFloat(parts[5]) || 0,
      },
    };
  } catch (err) {
    const detail = err.stderr || err.message || String(err);
    if (!detail.includes("Can't get current track") && !detail.includes("Application isn't running")) {
      console.error("[AppleScript error]:", String(detail).split("\n")[0]);
    }
    return { status: "closed", track: null };
  }
}

export function pollAppleMusic(intervalMs, onState) {
  const timer = setInterval(async () => {
    const state = await fetchAppleMusicState();
    onState(state);
  }, intervalMs);
  return () => clearInterval(timer);
}

export async function setPlayerPosition(seconds) {
  const script = `tell application "Music" to set player position to ${seconds}`;
  try {
    await writeFile(SCRIPT_PATH, script, "utf8");
    await execFileAsync("osascript", [SCRIPT_PATH], { encoding: "utf8", timeout: 5000 });
    console.log("[AppleScript] Set position:", seconds);
    return true;
  } catch (e) {
    console.error("[AppleScript] Set position failed:", e.message);
    return false;
  }
}

export async function togglePlayPause() {
  const script = `tell application "Music" to playpause`;
  try {
    await writeFile(SCRIPT_PATH, script, "utf8");
    await execFileAsync("osascript", [SCRIPT_PATH], { encoding: "utf8", timeout: 5000 });
    console.log("[AppleScript] Toggle play/pause");
    return true;
  } catch (e) {
    console.error("[AppleScript] Play/pause failed:", e.message);
    return false;
  }
}

export async function skipToNext() {
  const script = `tell application "Music" to next track`;
  try {
    await writeFile(SCRIPT_PATH, script, "utf8");
    await execFileAsync("osascript", [SCRIPT_PATH], { encoding: "utf8", timeout: 5000 });
    console.log("[AppleScript] Next track");
    return true;
  } catch (e) {
    console.error("[AppleScript] Next track failed:", e.message);
    return false;
  }
}

export async function skipToPrevious() {
  const script = `tell application "Music" to previous track`;
  try {
    await writeFile(SCRIPT_PATH, script, "utf8");
    await execFileAsync("osascript", [SCRIPT_PATH], { encoding: "utf8", timeout: 5000 });
    console.log("[AppleScript] Previous track");
    return true;
  } catch (e) {
    console.error("[AppleScript] Previous track failed:", e.message);
    return false;
  }
}
