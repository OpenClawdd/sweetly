import { app, BrowserWindow, globalShortcut, ipcMain, screen, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAppleMusicState, pollAppleMusic, setPlayerPosition, togglePlayPause, skipToNext, skipToPrevious, toggleShuffle, cycleRepeat, toggleFavorite } from "./appleMusic.js";
import { setMediaUserToken } from "./appleMusicApi.js";
import { fetchLyricsData } from "./lyrics/fetcher.js";
import { saveCustomLyrics } from "./lyrics/sources/custom.js";
import { setLyricsUpdatedListener, setAlignStatusListener, cancelAlignment, getActiveJobs } from "./lyrics/autoAligner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.join(__dirname, "../../build/preload/index.js");

console.log("[Sweetly-Main] __dirname:", __dirname);
console.log("[Sweetly-Main] PRELOAD_PATH:", PRELOAD_PATH);

let mainWindow = null;
let stopPoll = null;

let isMaximized = false;
let normalBounds = null;

let lastSentStatus = null;
let lastSentTrackKey = null;
let lastMusicState = null;

function safeSend(channel, data) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.log("[Sweetly-Main] safeSend SKIPPED: window destroyed", channel);
      return false;
    }
    const wc = mainWindow.webContents;
    if (!wc || wc.isDestroyed()) {
      console.log("[Sweetly-Main] safeSend SKIPPED: webContents destroyed", channel);
      return false;
    }
    wc.send(channel, data);
    console.log("[Sweetly-Main] safeSend OK:", channel, data?.status, data?.track?.name || "(no track)");
    return true;
  } catch (e) {
    console.error("[Sweetly-Main] safeSend ERROR:", channel, e.message);
    return false;
  }
}

let pollCount = 0;
let lastValidTrack = null;

function onMusicState(state) {
  pollCount++;

  if (state.track && state.track.name && state.track.name !== "Unknown Track") {
    lastValidTrack = state.track;
  } else if (lastValidTrack && (state.status === "playing" || state.status === "paused")) {
    state.track = {
      ...lastValidTrack,
      position: state.track?.position || lastValidTrack.position,
    };
  }

  const track = state.track;
  const trackKey = track ? `${track.nameCleaned}|||${track.artistCleaned}` : null;
  const status = state.status;

  const wouldSkip = (status !== "playing" && status === lastSentStatus && trackKey === lastSentTrackKey);

  if (pollCount <= 3 || pollCount % 20 === 0) {
    console.log(`[Sweetly-Main] Poll #${pollCount}: status=${status} track="${track?.name || ""}" pos=${track?.position} skip=${wouldSkip}`);
  }

  if (wouldSkip) {
    return;
  }

  // Track changed mid-capture — whatever we were recording is now the wrong
  // song, so stop it rather than aligning the next track's audio.
  if (lastSentTrackKey && trackKey !== lastSentTrackKey && lastMusicState?.track) {
    cancelAlignment(lastMusicState.track.nameCleaned, lastMusicState.track.artistCleaned);
  }

  lastSentStatus = status;
  lastSentTrackKey = trackKey;
  lastMusicState = state;
  safeSend("music-update", state);
}

async function toggleFullscreen() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log("[Sweetly-Main] toggleFullscreen: window not available");
    return;
  }

  if (isMaximized) {
    console.log("[Sweetly-Main] toggleFullscreen: restoring (unfullscreen)");
    if (normalBounds) {
      console.log("[Sweetly-Main] toggleFullscreen: normalBounds=", normalBounds);
      mainWindow.setBounds(normalBounds);
    }
    isMaximized = false;
  } else {
    console.log("[Sweetly-Main] toggleFullscreen: maximizing");
    normalBounds = mainWindow.getBounds();
    console.log("[Sweetly-Main] toggleFullscreen: saved bounds=", normalBounds);
    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.workArea;
    console.log("[Sweetly-Main] toggleFullscreen: workArea=", { x, y, width, height });
    mainWindow.setBounds({ x, y, width, height });
    isMaximized = true;
  }
}

function createWindow() {
  console.log("[Sweetly-Main] Creating BrowserWindow...");

  mainWindow = new BrowserWindow({
    width: 520,
    height: 380,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  console.log("[Sweetly-Main] BrowserWindow created, id:", mainWindow.id);

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnAllWorkspaces: true });

  mainWindow.webContents.once("dom-ready", () => {
    console.log("[Sweetly-Main] DOM ready, starting Apple Music poll every 2000ms");
    stopPoll = pollAppleMusic(2000, onMusicState);
  });

  let resizeTimer = null;
  mainWindow.on("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      console.log("[Sweetly-Main] Resize settled, sending cached state");
      if (lastMusicState) {
        safeSend("music-update", lastMusicState);
      }
    }, 150);
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error("[Sweetly-Main] FAILED to load:", code, desc, url);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[Sweetly-Main] Page finished loading");
  });

  // The renderer hosts Spicy's whole UI now, so a module-scope throw there is
  // invisible against a transparent window — nothing renders and nothing logs.
  // Forward its console to the terminal so failures are diagnosable.
  mainWindow.webContents.on("console-message", (event) => {
    const levels = ["debug", "info", "warning", "error"];
    const level = levels[event.level] ?? event.level;
    if (level === "error" || level === "warning" || event.message.startsWith("[Sweetly]")) {
      console.log(`[Renderer:${level}] ${event.message}  (${event.sourceId}:${event.line})`);
    }
  });

  mainWindow.on("closed", () => {
    console.log("[Sweetly-Main] Window closed");
    if (stopPoll) {
      stopPoll();
      stopPoll = null;
    }
    mainWindow = null;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? "http://localhost:5173" : null);
  if (devServerUrl) {
    console.log("[Sweetly-Main] Loading dev server URL:", devServerUrl);
    mainWindow.loadURL(devServerUrl);
    // Opt-in: the detached DevTools window otherwise covers the overlay on
    // every dev run. SWEETLY_DEVTOOLS=1 bun run dev
    if (process.env.SWEETLY_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    const filePath = path.join(__dirname, "../renderer/index.html");
    console.log("[Sweetly-Main] Loading file:", filePath);
    mainWindow.loadFile(filePath);
  }
}

app.setName("Sweetly");

app.commandLine.appendSwitch("no-sandbox");

console.log("[Sweetly-Main] Electron app starting...");

let appLeMediaUserToken = null;

app.whenReady().then(async () => {
  console.log("[Sweetly-Main] App ready, creating window");

  const ses = session.defaultSession;
  ses.webRequest.onHeadersReceived({ urls: ["https://*.mzstatic.com/*"] }, (details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        "access-control-allow-origin": ["*"],
        "access-control-allow-methods": ["GET, OPTIONS"],
      },
    });
  });

  try {
    const tokenPath = path.join(app.getPath("home"), ".sweetly-token");
    const fs = await import("node:fs/promises");
    appLeMediaUserToken = (await fs.readFile(tokenPath, "utf8")).trim();
  } catch {
    appLeMediaUserToken = process.env.MEDIA_USER_TOKEN || null;
  }

  if (appLeMediaUserToken) {
    setMediaUserToken(appLeMediaUserToken);
    console.log("[Sweetly-Main] Media user token loaded");
  } else {
    console.log("[Sweetly-Main] No media user token found (Apple Music API disabled)");
  }

  // When a background alignment finishes, tell the renderer to re-fetch — the
  // freshly written TTML is picked up by the custom source, which runs first.
  setAlignStatusListener((payload) => {
    console.log("[Sweetly-Main] Align status:", payload.phase, payload.name || "");
    safeSend("align-status", payload);
  });

  setLyricsUpdatedListener((name, artist) => {
    console.log("[Sweetly-Main] Alignment ready, notifying renderer:", name, artist);
    safeSend("lyrics-updated", { name, artist });
  });

  createWindow();
  const registered = globalShortcut.register("CommandOrControl+Shift+F", toggleFullscreen);
  console.log("[Sweetly-Main] Global shortcut Cmd+Shift+F registered:", registered);
});

app.on("window-all-closed", () => {
  // An alignment records for the length of the track. Quitting here would kill
  // the ffmpeg child mid-capture and throw away the whole run, so stay alive
  // until the job finishes and then exit on its own.
  const jobs = getActiveJobs();
  if (jobs.length > 0) {
    console.log(`[Sweetly-Main] Window closed but ${jobs.length} alignment job(s) running — finishing first:`, jobs.join(", "));
    const timer = setInterval(() => {
      if (getActiveJobs().length === 0) {
        clearInterval(timer);
        console.log("[Sweetly-Main] Alignment finished, quitting");
        globalShortcut.unregisterAll();
        app.quit();
      }
    }, 2000);
    return;
  }

  console.log("[Sweetly-Main] All windows closed, quitting");
  globalShortcut.unregisterAll();
  app.quit();
});

app.on("activate", () => {
  console.log("[Sweetly-Main] Activate event");
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("get-initial-state", async () => {
  console.log("[Sweetly-Main] IPC: get-initial-state");
  const state = await fetchAppleMusicState();
  console.log("[Sweetly-Main] get-initial-state result:", state?.status);
  return state;
});

ipcMain.handle("toggle-fullscreen", async () => {
  console.log("[Sweetly-Main] IPC: toggle-fullscreen");
  await toggleFullscreen();
  console.log("[Sweetly-Main] toggle-fullscreen done, sending cached state");
  if (lastMusicState) {
    safeSend("music-update", lastMusicState);
  }
});

// Spicy's Close ViewControl dismisses a Spotify page; here the equivalent is
// hiding the overlay window, which the dock icon brings back.
ipcMain.handle("hide-window", () => {
  console.log("[Sweetly-Main] IPC: hide-window");
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  return true;
});

ipcMain.handle("fetch-lyrics", async (_event, { name, artist, album }) => {
  console.log("[Sweetly-Main] IPC: fetch-lyrics name=", name, "artist=", artist, "album=", album);
  if (!name || name === "Unknown Track") {
    console.log("[Sweetly-Main] fetch-lyrics: rejected (bad name)");
    return null;
  }
  // The aligner needs to know how long the track is and whether we're near the
  // start, so it can decide whether a full capture is still possible.
  const playback = {
    duration: lastMusicState?.track?.duration,
    position: lastMusicState?.track?.position,
  };
  const result = await fetchLyricsData(name, artist, album, playback);
  console.log("[Sweetly-Main] fetch-lyrics: result=", result ? `data=${!!result.data} art=${!!result.artworkUrl}` : "null");
  return result;
});

ipcMain.handle("set-media-user-token", async (_event, token) => {
  console.log("[Sweetly-Main] IPC: set-media-user-token");
  const ok = setMediaUserToken(token);
  console.log("[Sweetly-Main] set-media-user-token:", ok ? "saved" : "failed (empty token)");
  return ok;
});

ipcMain.handle("save-custom-lyrics", async (_event, { name, artist, ttml }) => {
  if (!name || !artist || !ttml) return false;
  const ok = saveCustomLyrics(name, artist, ttml);
  console.log("[Sweetly-Main] Custom lyrics saved:", name, artist, ok);
  return ok;
});

ipcMain.handle("seek-to", async (_event, seconds) => {
  console.log("[Sweetly-Main] IPC: seek-to", seconds);
  return await setPlayerPosition(seconds);
});

ipcMain.handle("toggle-play-pause", async () => {
  console.log("[Sweetly-Main] IPC: toggle-play-pause");
  return await togglePlayPause();
});

ipcMain.handle("next-track", async () => {
  console.log("[Sweetly-Main] IPC: next-track");
  return await skipToNext();
});

ipcMain.handle("previous-track", async () => {
  console.log("[Sweetly-Main] IPC: previous-track");
  return await skipToPrevious();
});

ipcMain.handle("toggle-shuffle", async () => await toggleShuffle());

ipcMain.handle("cycle-repeat", async () => await cycleRepeat());

ipcMain.handle("toggle-favorite", async () => await toggleFavorite());
