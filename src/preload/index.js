import { contextBridge, ipcRenderer } from "electron";

try {
  console.log("[Sweetly-Preload] Setting up context bridge...");

  let musicUpdateCallback = null;
  const musicUpdateBuffer = [];

  ipcRenderer.on("music-update", (_event, state) => {
    try {
      if (musicUpdateCallback) {
        musicUpdateCallback(state);
      } else {
        musicUpdateBuffer.push(state);
      }
    } catch (e) {
      console.error("[Sweetly-Preload] music-update handler error:", e);
    }
  });

  let lyricsUpdatedCallback = null;
  ipcRenderer.on("lyrics-updated", (_event, payload) => {
    try {
      lyricsUpdatedCallback?.(payload);
    } catch (e) {
      console.error("[Sweetly-Preload] lyrics-updated handler error:", e);
    }
  });

  let alignStatusCallback = null;
  ipcRenderer.on("align-status", (_event, payload) => {
    try {
      alignStatusCallback?.(payload);
    } catch (e) {
      console.error("[Sweetly-Preload] align-status handler error:", e);
    }
  });

  contextBridge.exposeInMainWorld("electronAPI", {
    onLyricsUpdated: (callback) => {
      lyricsUpdatedCallback = callback;
      return () => {
        lyricsUpdatedCallback = null;
      };
    },
    onAlignStatus: (callback) => {
      alignStatusCallback = callback;
      return () => {
        alignStatusCallback = null;
      };
    },
    onMusicUpdate: (callback) => {
      musicUpdateCallback = callback;
      while (musicUpdateBuffer.length > 0) {
        callback(musicUpdateBuffer.shift());
      }
      return () => {
        musicUpdateCallback = null;
      };
    },
    getInitialState: () => ipcRenderer.invoke("get-initial-state"),
    toggleFullscreen: () => ipcRenderer.invoke("toggle-fullscreen"),
    hideWindow: () => ipcRenderer.invoke("hide-window"),
    fetchLyrics: (payload) => ipcRenderer.invoke("fetch-lyrics", payload),
    setMediaUserToken: (token) => ipcRenderer.invoke("set-media-user-token", token),
    getSetupStatus: () => ipcRenderer.invoke("get-setup-status"),
    spotifySignIn: () => ipcRenderer.invoke("spotify-sign-in"),
    saveCustomLyrics: (name, artist, ttml) =>
      ipcRenderer.invoke("save-custom-lyrics", { name, artist, ttml }),
    seekTo: (seconds) => ipcRenderer.invoke("seek-to", seconds),
    togglePlayPause: () => ipcRenderer.invoke("toggle-play-pause"),
    nextTrack: () => ipcRenderer.invoke("next-track"),
    previousTrack: () => ipcRenderer.invoke("previous-track"),
    toggleShuffle: () => ipcRenderer.invoke("toggle-shuffle"),
    cycleRepeat: () => ipcRenderer.invoke("cycle-repeat"),
    toggleFavorite: () => ipcRenderer.invoke("toggle-favorite"),
  });

  console.log("[Sweetly-Preload] contextBridge ready");
} catch (e) {
  console.error("[Sweetly-Preload] FATAL:", e.message, e.stack);
}
