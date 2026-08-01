# AGENTS.md

## Quickstart

```bash
cd ~/Code/spicy-apple-overlay
bun install
ELECTRON_DISABLE_SANDBOX=1 bun run dev
```

`src/main/index.js` calls `app.commandLine.appendSwitch("no-sandbox")`, but the env var is still needed for the preload sandbox during dev.

**First run** (dev or packaged): the setup gate appears until a media-user-token is saved. To bypass in dev, drop a token in `~/.sweetly-token` or set `MEDIA_USER_TOKEN`.

If the app shows "Open Apple Music to begin":

1. Open **System Settings > Privacy & Security > Automation**
2. Enable **Electron** for **Music** (play a song first to trigger the permission prompt)
3. Restart the app

## Architecture

This is an **Electron desktop app** that displays a floating/fullscreen lyrics overlay synced to Apple Music. The renderer is **vendored Spicy Lyrics** (AGPL-3.0) run standalone: `src/renderer/main.ts` replaces upstream's `app.tsx` entry, and adapter modules swap Spicy's Spotify hooks for Apple Music.

```
src/
├── main/
│   ├── index.js          # BrowserWindow + IPC + lyrics orchestration (Apple Music API → fallbacks)
│   ├── appleMusic.js     # AppleScript bridge, cleanTrackTitle, cleanArtistName, pollAppleMusic
│   ├── appleMusicApi.js  # Apple Music catalog API client (search, syllable-lyrics, artwork)
│   ├── spotifyAuth.js    # Optional Spotify OAuth (PKCE) for the Spicy Lyrics community source
│   └── lyrics/           # Provider chain, TTML parsing, alignment pipeline
├── preload/
│   └── index.js          # contextBridge (compiles to build/preload/index.js via electron-vite)
└── renderer/
    ├── main.ts           # Renderer entry — installs Spicetify shim, boots vendored Spicy UI
    ├── adapter/          # AppleMusicPlayer.ts, platformShim.ts, spicetifyShim.ts, eventPump.ts
    ├── setup/            # First-run setup gate (media-user-token + optional Spotify sign-in)
    ├── lyrics/           # fetchLyricsElectron.ts, toSpicyShape.ts
    └── upstream.ts       # Barrel that statically imports vendored Spicy modules in order
```

No TypeScript in main/preload — all `.js`. The vendored Spicy renderer under `src/` (components, css, utils, types) is TypeScript. TS under `src/main` or `src/renderer` is Sweetly's own.

## Build & package

```bash
bun run build       # electron-vite → build/{main,preload,renderer}
bun run dist:mac    # + electron-builder → dist/*.dmg (arm64 + x64)
bun test            # vitest run
bunx oxlint         # .oxlintrc.json at root
bunx oxfmt --check  # .oxfmtrc.json at root
```

- electron-vite compiles main → `build/main/index.js`, preload → `build/preload/index.js` (**CJS** — Electron preloads don't support ESM; enforced in `electron.vite.config.ts`), renderer → Vite build.
- `package.json` `main` is `./build/main/index.js`. Dev and packaged app resolve `__dirname` to `build/main/`, so `PRELOAD_PATH` (`../../build/preload/index.js`) and the renderer `loadFile` path both work in either mode.
- **Icon**: `buildResources/icon.svg` → `icon.png` (1024px). Regenerate with `qlmanage -t -s 1024 -o . buildResources/icon.svg` if you change the SVG.
- electron-builder config lives in `electron-builder.yml`. Signing uses whatever Apple Development identity is on the machine; notarization is skipped.

## Data flow

1. `pollAppleMusic(2000, onMusicState, getPollInterval)` runs `osascript` and emits `music-update` IPC. The interval tightens to 300ms near track end (automix).
2. `renderer/adapter/musicState.ts` stores the payload; `AppleMusicPlayer.ts` adapts it to Spicy's player surface. **Apple Music reports seconds; Spicy expects milliseconds everywhere** — conversion happens only in the adapter.
3. On track change, `renderer/lyrics/fetchLyricsElectron.ts` calls `fetch-lyrics` IPC. `main/lyrics/fetcher.js` walks its provider chain (custom → apple → binilyrics → spicylyrics → lrclib → genius) and returns `{ data, provider, artworkUrl }` with `data` already Spicy-shaped.
4. `main.ts` publishes `$currentLyricsType`, then calls upstream `ApplyLyrics`. A rAF loop drives the animator.

## Setup gate (first run)

`renderer/setup/setupGate.ts` mounts over `#app` before the Spicy UI boots when `get-setup-status` reports no media-user-token. It saves the token via `set-media-user-token` IPC (electron-store, `~/.sweetly-spotify`-style), then reloads. Skipping persists in `localStorage`. The optional Spotify section calls `spotify-sign-in` IPC → `authorize()` in `spotifyAuth.js` (PKCE loopback on port 8888).

## IPC Summary

| Channel                                                                                                                                   | Direction       | Purpose                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------- |
| `music-update`                                                                                                                            | Main → Renderer | Pushed every poll (or on state change)                              |
| `align-status` / `lyrics-updated`                                                                                                         | Main → Renderer | Alignment progress / completion                                     |
| `get-initial-state`                                                                                                                       | Renderer → Main | Current Apple Music state on mount                                  |
| `toggle-fullscreen`                                                                                                                       | Renderer → Main | Real macOS fullscreen toggle                                        |
| `fetch-lyrics`                                                                                                                            | Renderer → Main | Unified lyrics fetch. Returns `{ data, provider, artworkUrl }`      |
| `get-setup-status`                                                                                                                        | Renderer → Main | `{ hasMediaUserToken, spotifySignedIn, spotifyClientIdConfigured }` |
| `set-media-user-token`                                                                                                                    | Renderer → Main | Persist media-user-token to electron-store                          |
| `spotify-sign-in`                                                                                                                         | Renderer → Main | Interactive Spotify consent flow (optional)                         |
| `save-custom-lyrics`, `seek-to`, `toggle-play-pause`, `next-track`, `previous-track`, `toggle-shuffle`, `cycle-repeat`, `toggle-favorite` | Renderer → Main | Playback & custom lyrics                                            |

## The critical invariant: `src/` is a vendored AGPL fork

`src/` is a copy of **Spicy Lyrics 6.2.3** (AGPL-3.0, by Spikerko). This app runs Spicy's _actual_ renderer, not a reimplementation.

**Host-side first.** Every behavioural change belongs in `src/renderer/`, `src/main/`, `src/preload/` or `electron.vite.config.ts`. Before editing anything else under `src/`, look for the module-substitution, shim or event-pump equivalent — that is almost always where the change belongs, and a host-side fix survives an upstream bump that an in-place edit does not.

**Upstream edits are allowed but must earn it.** When you do edit upstream:

- Keep the diff minimal and local; do not reformat or "clean up" around it.
- Say so in the commit message, and say why the host-side route did not work.

Three seams make upstream run standalone against Apple Music:

1. **Module substitution.** A resolve-time Vite plugin in `electron.vite.config.ts` swaps `components/Global/SpotifyPlayer.ts` → `renderer/adapter/AppleMusicPlayer.ts` and `components/Global/Platform.ts` → `renderer/adapter/platformShim.ts`. It matches on the **resolved absolute path**, not the import specifier.
2. **`renderer/adapter/spicetifyShim.ts`** installs a minimal `globalThis.Spicetify` before any upstream module imports — several read `Spicetify` at module scope. Must run before upstream.ts is imported.
3. **`renderer/upstream.ts`** statically imports upstream in `app.tsx`'s order; `main.ts` pulls that one module in dynamically. Upstream has import cycles, so concurrent imports throw.

## The rule that matters most: upstream modules are not pure

Every substantial bug in this port has had one shape: **a replacement returned the right value but dropped a side effect the original had.** Upstream modules write nanostores, start `IntervalManager` loops, and mutate DOM classes as side effects of being called.

Before replacing or omitting any upstream module, grep it for `$store.set(`, `new IntervalManager`, `Global.Event.evoke`, and `classList` writes, and port each.

## Conventions

- Renderer never makes network requests directly — everything routes through the main process over IPC, and never touches `ipcRenderer` outside the `electronAPI` context bridge.
- Track-name normalisation lives in `appleMusic.js` (`cleanTrackTitle` / `cleanArtistName`); consumers read `nameCleaned` / `artistCleaned` and never re-clean.
- Preload must compile to **CJS**. `renderer/` is TypeScript; `main/` and `preload/` are `.js`. All ESM.
- Renderer errors are invisible behind a transparent window — `main/index.js` forwards the renderer console to the terminal. Use it.

## macOS gotchas

- **Automation permission**: the first `osascript` call fails until Automation access to Music is granted. Play a song to trigger the prompt, enable it under _System Settings → Privacy & Security → Automation_, restart. Polling recovers.
- **Apple Music lyrics** need a `media-user-token`, saved via the setup screen (or `~/.sweetly-token` / `MEDIA_USER_TOKEN` for dev). Without it the pipeline falls back to the other providers.
- **Spotify sign-in** is optional. It requires a client id: `scripts/` or env `SPOTIFY_CLIENT_ID`, plus a registered Redirect URI of `http://127.0.0.1:8888/callback`. Without it, the Spicy Lyrics community source is skipped.
- **Alignment** (`scripts/align_lyrics.py` + `main/lyrics/audioCapture.js`) needs a system ffmpeg and BlackHole for capture. It degrades gracefully when missing.
