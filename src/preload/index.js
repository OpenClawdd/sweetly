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
    } catch (e) { console.error("[Sweetly-Preload] music-update handler error:", e); }
  });

  contextBridge.exposeInMainWorld("electronAPI", {
    onMusicUpdate: (callback) => {
      musicUpdateCallback = callback;
      while (musicUpdateBuffer.length > 0) {
        callback(musicUpdateBuffer.shift());
      }
      return () => { musicUpdateCallback = null; };
    },
    getInitialState: () => ipcRenderer.invoke("get-initial-state"),
    toggleFullscreen: () => ipcRenderer.invoke("toggle-fullscreen"),
    fetchLyrics: (payload) => ipcRenderer.invoke("fetch-lyrics", payload),
    setMediaUserToken: (token) => ipcRenderer.invoke("set-media-user-token", token),
  saveCustomLyrics: (name, artist, ttml) => ipcRenderer.invoke("save-custom-lyrics", { name, artist, ttml }),
  seekTo: (seconds) => ipcRenderer.invoke("seek-to", seconds),
  togglePlayPause: () => ipcRenderer.invoke("toggle-play-pause"),
  nextTrack: () => ipcRenderer.invoke("next-track"),
  previousTrack: () => ipcRenderer.invoke("previous-track"),
});

  console.log("[Sweetly-Preload] contextBridge ready");
} catch (e) {
  console.error("[Sweetly-Preload] FATAL:", e.message, e.stack);
}
