# AGENTS.md

## Quickstart

```bash
cd ~/Code/spicy-apple-overlay
ELECTRON_DISABLE_SANDBOX=1 npx electron-vite dev
```

`src/main/index.js` calls `app.commandLine.appendSwitch("no-sandbox")`, but the env var is still needed for the preload sandbox during dev.

If the app shows "Open Apple Music to begin":
1. Open **System Settings > Privacy & Security > Automation**
2. Enable **Electron** for **Music** (play a song first to trigger the permission prompt)
3. Restart the app

### Media user token (Apple Music lyrics)

The app needs a `media-user-token` cookie from Apple Music's web player to fetch word-level synced lyrics. Place it in `~/.sweetly-token` (one line, just the token string). The app reads it at startup. If absent, lyrics fall back to scraping Spotify's public search page and querying `api.spicylyrics.org`.

## Architecture

This is an **Electron desktop app** that displays a floating/fullscreen lyrics overlay synced to Apple Music. The Spicetify build (`spice.config.ts` + `manifest.json`) is a legacy packaging target — the active runtime is the Electron window.

```
src/
├── main/
│   ├── index.js          # BrowserWindow + IPC + lyrics orchestration (Apple Music API → Spotify scrape fallback)
│   ├── appleMusic.js     # AppleScript bridge, cleanTrackTitle, cleanArtistName, pollAppleMusic
│   └── appleMusicApi.js  # Apple Music catalog API client (search, syllable-lyrics, artwork, token mgmt)
├── preload/
│   └── index.js          # contextBridge (compiles to build/preload/index.js via electron-vite)
├── renderer/
│   ├── index.html        # Root HTML + CSS (transparent bg, hidden scrollbars, slide animation)
│   ├── index.jsx         # React 19 createRoot mount into #app
│   └── App.jsx           # Fullscreen karaoke UI: spring physics, artwork bg, per-word glow, ErrorBoundary
└── utils/
    └── ttmlParser.js     # Parses spicylyrics TTML JSON into { lines: [{ words: [{ text, startTime, endTime }] }] }
```

## Build

- **electron-vite** compiles main → `build/main/index.js`, preload → `build/preload/index.js` (CJS), renderer → Vite dev server at `localhost:5173`
- Preload must compile to **CJS** (Electron preloads don't support ESM). `electron.vite.config.ts` enforces this: `format: "cjs"`, `entryFileNames: "index.js"`.
- Main's `PRELOAD_PATH` is `../../build/preload/index.js` (works in both dev and prod because `__dirname` is `src/main/` in dev and `build/main/` in prod — both resolve to `build/preload/index.js` via `../..`)
- Renderer in dev loads from `http://localhost:5173` (hardcoded fallback when `VITE_DEV_SERVER_URL` is unset)
- No TypeScript in the Electron app — all source is `.js`/`.jsx`. TS files under `src/` are from the legacy Spicetify extension.

## Data Flow

1. `pollAppleMusic(500, onMusicState)` runs every 500ms — AppleScript → `osascript` → parses `status|||name|||artist|||album|||position|||duration`
2. Main emits `music-update` IPC: `{ status, track: { name, nameCleaned, artist, artistCleaned, album, position, duration } }`
3. **Polling guard**: non-playing statuses with unchanged track are skipped. Playing statuses always send.
4. **IPC buffer**: the preload eagerly listens for `music-update` events and buffers them until React's listener registers, then flushes. No dropped initial events.
5. Renderer calls `fetch-lyrics` IPC with `{ name: nameCleaned, artist: artistCleaned }`. Main tries:
   a. **Apple Music API** (`amp-api.music.apple.com`) — uses hardcoded WebPlayKid developer token + `media-user-token` from `~/.sweetly-token`. Returns word-level TTML + album artwork URL.
   b. **Fallback**: scrapes `open.spotify.com/search` HTML for a Spotify track ID → POSTs `api.spicylyrics.org/query` with that ID
6. TTML is parsed by `ttmlParser.js` into word-level structures.
7. `App.jsx` renders a fullscreen karaoke UI with spring-physics animations, artwork-blurred background, per-word glow, and accent color extraction from album art.

## IPC Summary

| Channel | Direction | Purpose |
|---|---|---|
| `music-update` | Main → Renderer | Pushed every 500ms (or on state change) |
| `get-initial-state` | Renderer → Main | Fetch current Apple Music state on mount |
| `toggle-fullscreen` | Renderer → Main | Toggle between floating (520×380) and maximized |
| `fetch-lyrics` | Renderer → Main | Unified lyrics fetch (Apple Music API → Spotify scrape fallback). Returns `{ data, artworkUrl }` |
| `set-media-user-token` | Renderer → Main | Persist media-user-token to electron-store |

## Renderer Conventions

- **Error Boundary**: `App.jsx` exports `AppWithErrorBoundary` (class `ErrorBoundary` wrapping `<App />`). Any render crash shows a fallback UI.
- **Safe chaining**: All track/lyrics access uses optional chaining. `getActiveIndices` and `parseTTMLData` are try/catch wrapped.
- **Track name cleaning**: Never re-clean in the renderer — consume `nameCleaned` and `artistCleaned` from the IPC payload.
- **Spring physics**: Line opacities, word fill progress, word scale, glow intensity, accent color crossfades, and line blur/scale all use `springTick()` (stiffness + damping + velocity) running at 60fps. No CSS transitions for animation — all driven by `requestAnimationFrame` loops with `useRef`-based velocity state.
- **Karaoke rendering**: Active words use a two-span overlay (gray base + white reveal with `overflow: hidden` and dynamic width). Never `background-clip: text` (renders as blocks on some Electron/Chromium versions).
- **Font loading**: `document.fonts.ready` must resolve before the UI renders. Shows a minimal loading screen until fonts are available.
- **Artwork color**: `extractAccent()` samples the album art on a 4×4 canvas to extract a dominant HSL accent color, fed into the progress bar glow, karaoke word bloom, and inactive word tint.

## Fullscreen Toggle

- **Keyboard**: `Cmd+Shift+F` (global shortcut registered in main)
- **UI**: expand/collapse button (top-right corner)
- Maximize saves current bounds, expands to `screen.getPrimaryDisplay().workArea`. Restore puts it back. Cached `music-update` re-sent after each toggle.

## Debugging

- All three layers log tagged: `[Sweetly-Main]`, `[Sweetly-Preload]`, `[Sweetly-UI]`
- Red debug bar at window bottom shows live state. Hide with `const DEBUG = false` at top of `App.jsx`.
- Logs throttled: main polls every 3rd + every 20th, renderer first 5 + every 10th.

## macOS Gotchas

- **AppleScript TCC**: First `osascript` call fails until Automation permission is granted. Expected error messages (`"Can't get current track"`, `"Application isn't running"`) are silently swallowed.
- **Window `resize` event fires before the poll starts**: the debounced resize handler only becomes useful AFTER the first poll. Initial state comes from `get-initial-state` IPC on mount.
- **Renderer in dev must load from Vite dev server**: loading `file://` directly fails module MIME type checks. `main/index.js` hardcodes `http://localhost:5173` as fallback when `VITE_DEV_SERVER_URL` is unset.

## Lint / Format

```bash
bunx oxlint        # .oxlintrc.json at root
bunx oxfmt --check # .oxfmtrc.json at root
```

No scripts defined in `package.json`. `CLAUDE.md` prefers `bun`/`bunx` over `npm`/`npx`.
