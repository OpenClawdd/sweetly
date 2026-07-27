# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev — Electron window with Vite HMR for the renderer
bun run dev
# or directly:  npx electron-vite dev
# Sandbox must be disabled on Linux/macOS for AppleScript bridge:
ELECTRON_DISABLE_SANDBOX=1 npx electron-vite dev

# Production build — main/preload/renderer → build/
bun run build
# Spicetify packaging (builds/spicy-lyrics.mjs) is configured in spice.config.ts
# but is not driven by an npm script — invoke @spicemod/creator directly if needed.
```

No `lint` / `fmt` / `test` scripts are defined in `package.json` even though `oxlint` (`.oxlintrc.json`) and `oxfmt` (`.oxfmtrc.json`) are configured at the repo root. Run them directly via `bunx oxlint` / `bunx oxfmt` if you need them.

Prefer `bun` / `bunx` over `npm` / `npx` / `node` (see `.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc`).

## Architecture

This is an **Electron desktop app** (`sweetly-lyrics-overlay`) that displays a floating, always-on-top, vibrancy-glass lyrics overlay synced to whatever is playing in Apple Music. Despite the repo name and the existence of `spice.config.ts` + `manifest.json`, the actively-developed runtime is a standalone Electron window — not a Spicetify extension loaded inside Spotify. The Spicetify build is a separate packaging target.

Source layout (`src/`):

- `main/index.js` — Electron main process. Owns the `BrowserWindow` (transparent, `vibrancy: "popover"`, always-on-top, visible on all workspaces) and all network IO. Holds the cached Spotify access token and the `findSpotifyTrack` / `fetchSpicyLyrics` fetchers with `User-Agent` headers and `encodeURIComponent` query strings. Exposes IPC: `get-initial-state`, `fetch-spotify-track-id`, `fetch-spicy-lyrics`.
- `main/appleMusic.js` — Writes an AppleScript to `/tmp/sweetly-music.scpt` and runs `osascript` to read Music.app's current track. Exposes `fetchAppleMusicState()` and `pollAppleMusic(intervalMs, onState)`. Also exports `cleanTrackTitle` / `cleanArtistName` for sanitizing names before Spotify search.
- `preload/index.js` — `contextBridge` exposing `electronAPI` to the renderer: `onMusicUpdate`, `onLyricsUpdate`, `fetchSpotifyTrackId`, `fetchSpicyLyrics`. Keeps the renderer sandboxed (no Node, context isolation on).
- `renderer/index.html` — Root HTML + global CSS. Forces `html, body, #root, #app` to transparent backgrounds with `!important` so Chromium doesn't paint an opaque fill behind the vibrancy glass.
- `renderer/index.jsx` — React 19 `createRoot` mount into `#app`.
- `renderer/App.jsx` — UI. Subscribes to `music-update` IPC, runs the lyrics pipeline when status is `playing` and track is not `"Unknown Track"`, and renders either `<LyricsView>` or `<FallbackView>` (title/artist/status). The lyrics pipeline guard short-circuits on `paused` / `stopped` / missing track.
- `utils/ttmlParser.js` — Parses spicylyrics API response into `{ lines: [{ words: [{ text, startTime, endTime }] }] }`, grouping syllables into words using `IsPartOfWord` flags.

## Data flow

1. `pollAppleMusic(500, …)` in the main process runs `osascript` every 500 ms.
2. AppleScript returns `status|||name|||artist|||album|||position|||duration`; main emits `music-update` IPC to the renderer.
3. On a new `(nameCleaned, artistCleaned)` key while `status === "playing"`, the renderer asks the main process for a Spotify track id (which uses the cached anonymous `open.spotify.com/get_access_token` token and queries `api.spotify.com/v1/search`).
4. The renderer then invokes `fetch-spicy-lyrics` with the Spotify id; main process POSTs to `api.spicylyrics.org/query`.
5. The TTML response is parsed by `ttmlParser.js`. `App.jsx` maps lines → flex rows, words → spans, and highlights the active word based on `state.track.position`.

## macOS gotchas

- **Automation permission**: first `osascript` call from Electron fails until the user grants Automation access to Music. Trigger the permission prompt by playing a song, then enable it in *System Settings → Privacy & Security → Automation*. Subsequent polls recover automatically.
- **`open.spotify.com/get_access_token`**: the anonymous web-player token endpoint may 403 when called from the Node main process. The token must be fetched from a real browser context (currently handled inside the main process with a Safari-like User-Agent; if it stops working, move the fetch back to the renderer and proxy the resulting token through IPC).
- **`api.spicylyrics.org` CORS**: the spicylyrics API does not allow renderer-side fetches reliably, which is why all spicylyrics IO is proxied through `ipcMain.handle("fetch-spicy-lyrics", …)` in the main process.

## Conventions

- All source is `.js` / `.jsx` (no TypeScript), ESM (`"type": "module"` in `package.json`).
- React 19 with `createRoot` — no `ReactDOM.render`.
- IPC payloads are plain JSON; renderer never touches `ipcRenderer` directly — go through the `electronAPI` context bridge.
- The renderer must never make Spotify or spicylyrics requests itself; route them through the main process so CORS / TLS fingerprinting work and so tokens can be cached server-side.
- Track-name normalization lives in `appleMusic.js` (`cleanTrackTitle` / `cleanArtistName`); the renderer consumes `nameCleaned` / `artistCleaned` from the IPC payload and never re-cleans.
