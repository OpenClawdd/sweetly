# Sweetly — Code Review for Gemini

Electron app that displays a floating/fullscreen karaoke lyrics overlay for Apple Music. Fork of SpicyLyrics (Spicetify extension), with a custom Electron renderer layered on top.

**Run:** `npm run dev` (sandbox handled automatically)

---

## Architecture

```
src/main/index.js          — BrowserWindow + IPC hub + 8-source lyrics fetcher
src/main/appleMusic.js     — AppleScript bridge (poll state, seek, play/pause, skip)
src/main/appleMusicApi.js  — Apple Music catalog API (search, syllable-lyrics, artwork, TTML parser)
src/preload/index.js       — contextBridge exposing ~12 IPC methods
src/renderer/App.jsx       — Fullscreen karaoke UI (~740 lines, all inline JS styles)
src/renderer/index.html    — Root HTML + global CSS + font CDN links
src/renderer/index.jsx     — React 19 createRoot mount
src/utils/ttmlParser.js    — Parses spicylyrics JSON format into {lines: [{words: [...]}]}
src/modules/Spring.ts      — Fraktality SPR port (analytical spring physics, identical to SpicyLyrics)
```

## Lyrics Pipeline (8 sources, tried in order)

| # | Source | Sync level | Auth |
|---|--------|-----------|------|
| 1 | Custom (user-uploaded TTML) | Word | None |
| 2 | Apple Music API (`amp-api.music.apple.com`) | Word/Line | media-user-token in `~/.sweetly-token` |
| 3 | BiniLyrics (`lyrics-api.binimum.org`) | Word | None |
| 4 | LRCLIB (`lrclib.net`) | Line (LRC) | None |
| 5 | Genius (scrape `genius.com`) | Plain text | None |
| 6 | Spotify HTML scrape → spicylyrics.org | Word | None |
| 7 | Apple Music API fallback | Line | Token |

Artwork always comes from Apple Music (hardcoded WebPlayKid developer token). Apple `mzstatic.com` CDN has CORS issues — images are proxied through main process as `data:` URLs.

## Current State — What Works

### ✅ Core
- AppleScript poll at 500ms → `music-update` IPC → React state
- Word-level karaoke for Apple Music tracks with `timing="Word"` TTML
- Line-level fallback from all other sources
- Spring-based line opacity/blur animations (Fraktality SPR port, 3Hz, 0.6 damping)
- Continuous scroll following active line with Spring physics (3Hz, 0.65 damping)
- Album art display with ♪ fallback + dynamic accent color extraction
- Static CSS blur background + Kawarp WebGL canvas (dynamic import, may fail)
- Click-to-seek on lyric lines → AppleScript `set player position`
- Play/pause, prev/next buttons in header → AppleScript

### ⚠️ Partially Working
- **Kawarp** — Dynamic import of `@kawarp/core`. Canvas sized to `devicePixelRatio`. Fades in over static blur when ready. May fail silently on some machines (no WebGL context). Falls back to static CSS blur.
- **Spotify scrape** — Embeds page + search page with 5 regex patterns. Unreliable — Spotify's page is client-rendered, the initial HTML often doesn't contain track data.
- **Custom lyrics** — IPC infrastructure exists but no UI for uploading. Can be called from DevTools: `window.electronAPI.saveCustomLyrics(name, artist, ttml)`
- **Album art** — Proxied through main process as base64 to bypass CORS. Works but adds latency and IPC overhead per image.

### ❌ Not Working / Missing
- **Word-level for all tracks** — Only works when Apple Music or BiniLyrics has `timing="Word"`. LRCLIB and Genius provide line-level only. Spotify scrape unreliable → spicylyrics rarely reached.
- **No virtualizer** — All lyrics lines are mounted in DOM. Fine for 80-line songs, breaks on 500+ line tracks.
- **No reduced-motion support** — Springs and Kawarp run unconditionally.
- **No RTL support** — Despite Vazirmatn font loaded, no Arabic/Hebrew handling.
- **No background vocals/ad-libs** — TTML parser doesn't extract `Background` vocal data.
- **No musical dots for instrumental gaps** — Dot rendering code exists but gap detection is missing from parser output.
- **No proper font pre-warming** — `ApplyFontPixel()` from `Fonts.ts` exists but isn't called.

---

## Known Issues (file:line)

### Critical
1. **`App.jsx:6` — Stale `KARAOKE_SMOOTH` constant**. Removed all usage but constant remains. Dead code.

2. **`appleMusicApi.js:305` — Stale `console.log` in parser**. `if (lines.length === 1)` block prints first line spans — left from debugging, fires every parse.

3. **`App.jsx:249` — `getWordProgress` was deleted** but `renderLines` gap detection (line ~380) accesses `line?.words?.[0]?.endTime` etc. — works because `words` array is still present in parsed data. Fragile.

### High
4. **`App.jsx:495` — Palette extraction effect** depends on `artworkDataUrl || artworkUrl`. If `fetch-image` IPC is slow, `artworkUrl` is used, which fails CORS for `getImageData()`. Should gate on `artworkDataUrl` only.

5. **`App.jsx:549` — Accent spring loop** runs every frame even when no palette exists. Creates unnecessary rAF + React state updates.

6. **`App.jsx:585` — `kawarpCanvasRef`** passed to `BG_STATIC` condition is inverted — static BG always renders, Kawarp fades over it. Fine, but the `opacity: kawarpReady ? 1 : 0` transition means Kawarp canvas is always in DOM consuming GPU memory.

### Medium
7. **Inline styles everywhere** — No CSS modules, no styled-components, no Tailwind. All 740 lines use raw JS objects. Makes theming/refactoring difficult.

8. **Spring instances recreated** — `App.jsx:372` recreates `scrollSpring` on user scroll resume. Old spring is abandoned (garbage collected). Could just `SetGoal` + snap position.

9. **No error telemetry** — Failed IPC calls, parse errors, and image load failures are `console.log` only. No fallback UI for the user.

---

## SpicyLyrics vs Sweetly Gap

| Feature | SpicyLyrics | Sweetly |
|---------|------------|---------|
| Letter-level emphasis | Per-letter DOM + springs | Word-level only |
| Background vocals | `.bg-line` with 75% font-size | Not parsed |
| Musical dots | 3-dot spring animation for gaps | Not rendered |
| Vertical virtualizer | TanStack Virtual | All lines mounted |
| Audio-reactive BG speed | Spotify audio analysis → Kawarp speed | Static 0.7 speed |
| CSS variable system | `--gradient-position` with `@property` | Two-span overlay (removed) |
| Font pre-warming | `ApplyFontPixel()` for all weights | `document.fonts.ready` only |
| RTL languages | Arabic, Hebrew, Persian | None |
| Line hover | Glass backdrop blur pill | 4% white background |
| Reduced motion | `@media (prefers-reduced-motion)` | None |
| Custom lyrics UI | Full upload modal + IndexedDB | DevTools-only |

---

## Areas Ripe for Improvement

### Architecture
1. **Move TTML parsing out of main process.** `appleMusicApi.js` has its own TTML parser that duplicates logic in `ttmlParser.js`. Unify into a single parser that handles both raw XML and spicylyrics JSON format.

2. **Virtualize lyrics.** Import the existing `LyricsVirtualizer.ts` (996 lines, already in repo at `spicy-lyrics/src/utils/Lyrics/LyricsVirtualizer.ts`) into the Electron renderer. Removes the 500-line DOM limit.

3. **Extract animation system into a hook.** The 200+ lines of spring management in `LyricsView` should be `useSpringMap()` or `useLyricSprings()`.

### Performance
4. **Gate the spring loop.** Only run the 60fps opacity/blur spring loop when there are unsettled springs. Currently runs every frame even when all springs are asleep.

5. **Cache line measurements.** `offsetTop` is called on scroll during the spring loop. Measurements should be cached and invalidated only on resize/lyrics change.

6. **Batch DOM writes.** Multiple `scrollTop` assignments per frame. Should use `requestAnimationFrame` batching or a single write at the end of the spring loop.

### Visual Polish
7. **Add entrance animations.** Lines fading in from `opacity: 0` when they first enter the viewport. Currently they just appear at target opacity.

8. **Smooth track transitions.** Crossfade old lyrics → new lyrics over 300ms instead of instant swap.

9. **Progress bar uses accent color.** The hardcoded white `PROGRESS_FILL` could use `displayAccent` for dynamic theming tied to album art.

10. **Toggle button redesign.** The 4-button header bar (prev, play, next, fullscreen) is cramped at 28px each. Consider a larger hit area or combined control group.

### Accessibility
11. **Add `prefers-reduced-motion` check.** When enabled, replace all Spring animations with instant CSS transitions, pause Kawarp, and disable scroll physics.

12. **Keyboard navigation for lyrics.** Arrow keys to move between lines, Enter to seek.

### Lyrics Sources
13. **Better Lyrics unified API.** Their backend (`CUBEY_LYRICS_API_URL + "v2/lyrics"`) aggregates Musixmatch, QQ Music, KuGou, and community sources into one SSE stream. Requires Cloudflare Turnstile (browser-only) — would need to proxy through renderer context.

14. **NetEase Cloud Music.** Has public APIs for searching and fetching lyrics. Chinese-focused, good coverage for Asian music.

---

## File Size Hotspots

| File | Lines | Concern |
|------|-------|---------|
| `src/renderer/App.jsx` | 743 | Too large. Split into `LyricsView.jsx`, `KaraokeWord.jsx`, `Background.jsx`, `Header.jsx` |
| `src/main/index.js` | 487 | Mixes window management, IPC, 8 fetch functions, and Spotify scrape. Extract lyrics fetchers into `src/main/lyricsFetchers.js` |
| `src/main/appleMusicApi.js` | 340 | Contains API client + TTML parser. Split parser to `src/utils/appleTtmlParser.js` |

---

## Quick Wins (under 30 min each)
1. Fix palette extraction to use `artworkDataUrl` only (line 495) — prevents CORS errors
2. Gate spring loop behind `changed` flag (line 350) — already has `changed` variable, just add early return
3. Remove `KARAOKE_SMOOTH` dead constant (line 6)
4. Add `prefers-reduced-motion` media query — disable all springs
5. Extract 8 fetch functions from `main/index.js` into separate file

---

## SpicyLyrics Reference Code (from `spicy-lyrics/src/`)

These are the key SpicyLyrics modules Sweetly inherited but underuses.

### Spring.ts — Fraktality SPR port (identical in both)
`spicy-lyrics/src/modules/Spring.ts` / `src/modules/Spring.ts`
Analytical spring physics: `Step(dt)`, `SetGoal(goal, replacePosition?)`, `CanSleep()`. Three damping cases. Already imported in Sweetly.

### LyricsAnimator.ts — Per-word/letter spring engine
`spicy-lyrics/src/utils/Lyrics/Animator/Lyrics/LyricsAnimator.ts`
Core animation loop. Creates spring instances per word (Scale/YOffset/Glow), per letter, per dot (Scale/YOffset/Glow/Opacity), per line (Glow). 60fps with spline curves. Sweetly reimplements a simpler version.

### Emphasize.ts — Letter-level DOM splitting
`spicy-lyrics/src/utils/Lyrics/Applyer/Utils/Emphasize.ts`
Splits words into `<span class="letter">` elements with per-letter timing. Creates LetterData objects. Sweetly doesn't use this.

### LyricsVirtualizer.ts — TanStack Virtual scroll (996 lines)
`spicy-lyrics/src/utils/Lyrics/LyricsVirtualizer.ts`
Absolute-positioned divs, gap system, ResizeObserver, MutationObserver, self-healing watchdog, scrollToIndex with retry. Sweetly uses naive scrollTop.

### IsLetterCapable.ts — Letter emphasis threshold
`spicy-lyrics/src/utils/Lyrics/Applyer/Utils/IsLetterCapable.ts`
Determines if a word should split into letters (min 0.15s per letter).

### Dynamic Background
`spicy-lyrics/src/components/DynamicBG/dynamicBackground.ts` — Kawarp + Spotify color API
`spicy-lyrics/src/components/DynamicBG/BackgroundAnimationController.ts` — Audio-reactive speed
Sweetly copies files but uses hardcoded speed 0.7.

### Font loading
`spicy-lyrics/src/components/Styling/Fonts.ts` (identical in src/components/Styling/Fonts.ts)
`LoadFonts()` injects link elements. `ApplyFontPixel()` pre-warms 9 font weights. Sweetly never calls the latter.

### TTML processing chain (SpicyLyrics original)
`spicy-lyrics/src/utils/Lyrics/Applyer/Synced/Syllable.ts` — syllable renderer
`spicy-lyrics/src/utils/Lyrics/Applyer/Synced/Line.ts` — line + dot rendering
`spicy-lyrics/src/utils/Lyrics/Applyer/Static.ts` — plain text fallback
`spicy-lyrics/src/utils/Lyrics/tools.ts` — format converters
`spicy-lyrics/src/utils/Lyrics/fetchLyrics.ts` — Spicetify lyrics fetcher
These create `.line > .word-group > .word > .letter` DOM. Sweetly replaces with flat div per line + span per word.

### CSS system
`spicy-lyrics/src/css/Lyrics/Mixed.css` — @property declarations, gradient sweep, dots
`spicy-lyrics/src/css/default.css` — main stylesheet
`spicy-lyrics/src/css/tokens.css` — CSS custom properties
Variables: `--SLM_GradientPosition`, `--text-shadow-blur-radius`, `--text-shadow-opacity`, `--BlurAmount`, `--DefaultLyricsSize`.

---

## Key Sweetly Code (Electron layer)

These are the 7 files Sweetly adds on top of SpicyLyrics. Everything else is shared.

### src/main/index.js — IPC hub + 8-source lyrics fetcher (487 lines)
Key sections:
- Lines 98–150: `fetchLyricsData()` orchestrates 8 sources in priority order
- Lines 152–210: `fetchLRCLib()`, `fetchGenius()`, `fetchBiniLyrics()` — individual source fetchers
- Lines 212–260: `scrapeSpotifySearch()` + `fetchSpicyLyricsData()` — Spotify fallback
- Lines 337–383: IPC handlers: `fetch-lyrics`, `toggle-fullscreen`, `seek-to`, `toggle-play-pause`, `next-track`, `previous-track`, `set-media-user-token`, `save-custom-lyrics`, `fetch-image`
- Lines 80–96: `fetchLyricsData()` — checks custom lyrics first, then Apple, BiniLyrics, LRCLIB, Genius, Spotify, Apple fallback

### src/main/appleMusicApi.js — Apple Music catalog API (340 lines)
- Lines 28–50: `getMediaUserToken()` / `setMediaUserToken()` — electron-store persistence
- Lines 52–70: `getStorefront()` — resolves `us`/`en-US` from media-user-token
- Lines 72–120: `searchTrack()` — queries `amp-api.music.apple.com/v1/catalog/{storefront}/search`
- Lines 122–195: `fetchLyrics()` — tries song endpoint (relationships), then `/syllable-lyrics` sub-resource, then `/lyrics` fallback
- Lines 197–340: `parseTtmlXmlToJson()` — regex-based TTML XML parser converting to spicylyrics JSON format `{Content: [{Lead: {Syllables: [...]}}]}`. Handles namespace stripping, inter-span whitespace detection, 2/3-part timestamps.

### src/main/appleMusic.js — AppleScript bridge (175 lines)
- `fetchAppleMusicState()` — runs osascript, returns `{status, track: {name, artist, album, position, duration}}`
- `cleanTrackTitle()` — strips (feat.), (Deluxe), (Remastered), censored words
- `cleanArtistName()` — splits on `—`, `-`, `(`, `[` to remove feature annotations
- `pollAppleMusic(ms, callback)` — setInterval wrapper
- `setPlayerPosition(seconds)` — AppleScript seek
- `togglePlayPause()` / `skipToNext()` / `skipToPrevious()` — playback controls

### src/renderer/App.jsx — Fullscreen karaoke UI (743 lines)
Key components and their line ranges:
- Lines 37–62: Style constants (colors, z-index scale, typography)
- Lines 123–135: `WORD_PAST`, `WORD_ACTIVE_UNSUNG`, `WORD_INACTIVE` — three word states
- Lines 209–240: `extractPalette()` — 32x32 canvas, quantized color buckets, top 5 HSL colors
- Lines 242–260: `KaraokeWord()` — pure inline span, no overlay, three visual states
- Lines 262–438: `LyricsView()` — scroll container, spring loop (opacity + blur per line), renderLines with dot insertion for 3s+ gaps, click-to-seek
- Lines 455–510: Spring management — `useRef(new Map())` of `{opacity: Spring, blur: Spring}` per line, stepped at 60fps
- Lines 520–640: `App()` — state management, IPC listeners, rAF time interpolation, lyrics fetch, palette → accent crossfade, Kawarp init, font loading
- Lines 640–743: Render tree — CONTAINER > BG_STATIC > Kawarp canvas > VIGNETTE > GRAIN > HEADER (4 buttons) > LEFT_PANEL (artwork, progress, title, artist) > RIGHT_PANEL (lyrics or fallback)

### src/preload/index.js — contextBridge (28 lines)
Exposes 12 methods: `onMusicUpdate`, `getInitialState`, `toggleFullscreen`, `fetchLyrics`, `setMediaUserToken`, `saveCustomLyrics`, `seekTo`, `togglePlayPause`, `nextTrack`, `previousTrack`, `fetchImage`, `fetchSpicyLyrics` (dead code).

### src/utils/ttmlParser.js — SpicyLyrics JSON parser (88 lines)
- `parseTTMLData(apiResponse)` — expects `{Content: [{Lead: {Syllables: [{Text, StartTime, EndTime, IsPartOfWord}]}}]}`, returns `{lines: [{words: [{text, startTime, endTime}]}]}`
- `groupSyllablesIntoWords()` — merges syllables where `IsPartOfWord === true`
- `getActiveIndices(lines, currentTimeSeconds)` — binary search for active line/word

### src/renderer/index.html — Root HTML
- CSP allows `font-src`, `img-src`, `connect-src` for CDNs and APIs
- SpicyLyrics + Vazirmatn font CDN links
- `::-webkit-scrollbar { display: none }`, button hover/focus/active states, `.lyric-line:hover`
- `@keyframes slide` for loader bar, `@keyframes shimmer` for word activation

### electron.vite.config.ts — Build config
Preload MUST compile to CJS: `format: "cjs"`, `entryFileNames: "index.js"`. Electron does not support ESM preloads.

### package.json
ESM project (`"type": "module"`). React 19, Electron 43, electron-vite 5, @kawarp/core 1.2.0, electron-store 10.

---

## Scope Constraint for Gemini

**Sweetly is a macOS Electron desktop app, NOT a browser extension or web app.**

- Lyrics come from the native Music.app via AppleScript (`osascript`), not from Apple Music Web Player or MusicKit JS.
- The renderer is a React 19 SPA inside an Electron `BrowserWindow` (transparent, always-on-top, frameless).
- There is no DOM injection, no content script, no web extension manifest.
- Apple Music API (`amp-api.music.apple.com`) is called from the Electron main process (Node.js), not from a browser context.
- Album artwork comes from Apple's CDN (`mzstatic.com`) with CORS headers injected at the Electron session layer.
- All lyrics sources are called from Node.js `fetch()` in the main process.

**Do not propose:**
- Chrome/Firefox/Safari extensions
- Content script injection into music.apple.com
- MusicKit JS (`MusicKit.getInstance()`)
- Web extension manifests or browser permissions
- Apple Music Web Player DOM scraping

**Focus on:**
- Electron + React 19 architecture improvements
- Spring physics animation polish (Fraktality SPR port)
- Lyrics source pipeline optimization (8 sources, Node.js fetch)
- Performance: idle spring loop, osascript throttling, CORS session injection
- Visual fidelity: matching SpicyLyrics letter-level emphasis, gradient sweeps, background vocals
- Code organization: splitting 743-line App.jsx, extracting fetchers from main
