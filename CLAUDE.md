# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev            # Electron window + Vite HMR (sets ELECTRON_DISABLE_SANDBOX=1)
npm run build          # main/preload/renderer → build/
npm test               # vitest run
npm run test:watch     # vitest watch

npx vitest run tests/adapter/musicState.test.ts        # single file
npx vitest run -t "converts duration from seconds"     # single test by name
```

`ELECTRON_DISABLE_SANDBOX=1` is required for the AppleScript bridge even though
`main/index.js` also calls `app.commandLine.appendSwitch("no-sandbox")` — the env
var covers the preload sandbox during dev.

`oxlint` / `oxfmt` are configured (`.oxlintrc.json`, `.oxfmtrc.json`) but have no
npm scripts: run `npx oxlint` / `npx oxfmt` directly.

**Use npm, not bun.** `.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc`
says to prefer bun, but bun is not installed on this machine and the repo carries
a `package-lock.json`. The `bun.lock` at the root came from upstream. Tests are
vitest, not `bun test`.

The Spicetify packaging target (`spice.config.ts`, `manifest.json`,
`builds/spicy-lyrics.mjs`) is inherited from upstream and not actively developed.

## The critical invariant: `src/` is a vendored AGPL fork

`src/` is a copy of **Spicy Lyrics 6.2.3** (AGPL-3.0, by Spikerko). `spicy-lyrics/`
is a pristine upstream clone kept for diffing. This app runs Spicy's *actual*
renderer, not a reimplementation of it.

**Never edit anything under `src/` except `main/`, `preload/` and `renderer/`.**
Upstream stays byte-identical so `diff -r src spicy-lyrics/src` remains the
statement of changes AGPL-3.0 requires. Every behavioural change goes in
`src/renderer/` or in `electron.vite.config.ts`. If a fix appears to require
editing upstream, find the host-side equivalent instead.

Licensing is documented in `NOTICE`; obligations attach on distribution, not on
personal use. Do not reintroduce "Spicy Lyrics" as this project's identity in
`README.md`, `manifest.json`, or window titles — a copyright licence is not a
trademark licence.

## How Spicy's renderer is hosted

Upstream is a Spicetify extension that runs inside Spotify. Three seams make it
run standalone against Apple Music:

1. **Module substitution.** A resolve-time Vite plugin in
   `electron.vite.config.ts` swaps `components/Global/SpotifyPlayer.ts` →
   `renderer/adapter/AppleMusicPlayer.ts` and `components/Global/Platform.ts` →
   `renderer/adapter/platformShim.ts`. It matches on the **resolved absolute
   path**, not the import specifier — upstream writes those imports ten different
   ways, with and without extensions. Consumers keep their original imports, so
   upstream files are untouched.

2. **`renderer/adapter/spicetifyShim.ts`** installs a minimal
   `globalThis.Spicetify`. Only a handful of APIs are needed: `Tippy`/`TippyProps`
   (PageView tooltips), `Player.setShuffle`/`setRepeat`/`isPlaying`,
   `GraphQL.Request` (background colours, replaced by local artwork extraction),
   `Platform.PlaybackAPI`/`PlayerAPI` (read by `GetProgress`), and `LocalStorage`.
   It **must** run before any upstream module is imported — several read
   `Spicetify` at module scope.

3. **`renderer/upstream.ts`** is a barrel that statically imports upstream in
   `app.tsx`'s order, and `main.ts` pulls in that one module dynamically. Upstream
   has import cycles (`PageView.ts` exports a mutable `PageContainer` that the
   applyers read); importing modules individually with `Promise.all` evaluates
   them in an order `app.tsx` never produces and throws *"Cannot access
   'PageContainer' before initialization"*.

`renderer/main.ts` replaces upstream's `app.tsx`, minus everything that exists to
embed into Spotify's chrome (NPVLyrics, PopupLyrics, now-playing-bar observers,
update dialog, migration).

## The rule that matters most: upstream modules are not pure

Every substantial bug in this port has had one shape: **a replacement returned the
right value but dropped a side effect the original had.** Upstream modules write
nanostores, start `IntervalManager` loops, and mutate DOM classes as side effects
of being called.

Two that cost hours:

- `fetchLyrics.ts:43` sets `$currentLyricsType` inside `presentLyrics()`. Left at
  `"None"`, `LyricsAnimator.ts:539` early-returns, no line receives an
  `Active`/`Sung`/`NotSung` class, and since `css/Lyrics/Mixed.css:29-37` sets
  `-webkit-text-fill-color: transparent` on `.line`/`.word`/`.letter` while every
  ink source is class-gated (`Mixed.css:75-107`), **all lyrics render at correct
  size, position and opacity — completely invisible.**
- `app.tsx:765` is the only call site of `ScrollToActiveLine` in the whole tree.
  Without it there is no autoscroll and the virtualizer never advances past its
  initial window.

Before replacing or omitting any upstream module, grep it for `$store.set(`,
`new IntervalManager`, `Global.Event.evoke`, and `classList` writes, and port each.

Corollaries:
- When an element "exists with sane computed styles but does not paint", inspect
  its **children**. A parent's `color` is meaningless under
  `-webkit-text-fill-color`.
- `ScrollSimplebar` is a live `export let` (nulled on every `ApplyLyrics`,
  reassigned on mount). Read it through the module namespace; destructuring
  captures a stale `null`.

## Data flow

1. `pollAppleMusic(2000, …)` runs `osascript` and emits `music-update` IPC.
2. `renderer/adapter/musicState.ts` stores the payload; `AppleMusicPlayer.ts`
   adapts it to `SpotifyPlayer`'s surface. **Apple Music reports seconds; Spicy
   expects milliseconds everywhere** — conversion happens only in the adapter.
3. On a track change, `renderer/lyrics/fetchLyricsElectron.ts` calls
   `fetch-lyrics` IPC. `main/lyrics/fetcher.js` walks its provider chain (custom
   → apple → binilyrics → spicylyrics → lrclib → genius) and returns
   `{ data, provider, artworkUrl }`, where `data` is **already Spicy-shaped**
   (`{ Type, Content }`) — the main process parses TTML itself.
4. `main.ts` publishes `$currentLyricsType`, then calls upstream `ApplyLyrics`.
   A self-starting rAF loop in `utils/Lyrics/lyrics.ts:228` drives the animator.

`renderer/lyrics/toSpicyShape.ts` converts *locally-sourced* TTML on-device.
Do not use upstream's `utils/Lyrics/manager/parseTTML.ts` for this — it is a
remote call to Spicy's hosted API, not a local parser.

Custom TTML lives in `~/.sweetly-custom/*.ttml`, fuzzy-matched by
`main/lyrics/customKey.js`. `scripts/align_lyrics.py` generates word-level timings
(prefers Qwen3-ForcedAligner when given `--lyrics`, falls back to WhisperX ASR).

## Conventions

- Renderer never makes network requests directly — everything routes through the
  main process over IPC, and never touches `ipcRenderer` outside the
  `electronAPI` context bridge.
- Track-name normalisation lives in `appleMusic.js` (`cleanTrackTitle` /
  `cleanArtistName`); consumers read `nameCleaned` / `artistCleaned` and never
  re-clean.
- Preload must compile to **CJS** — Electron preloads don't support ESM.
  `electron.vite.config.ts` enforces this.
- `renderer/` is TypeScript; `main/` and `preload/` are `.js`. All ESM.

## macOS gotchas

- **Automation permission**: the first `osascript` call fails until Automation
  access to Music is granted. Play a song to trigger the prompt, enable it under
  *System Settings → Privacy & Security → Automation*, restart. Polling recovers.
- **Apple Music lyrics** need a `media-user-token` cookie from the web player,
  read from `~/.sweetly-token` (one line). Without it the pipeline falls back to
  the other providers.
- Renderer errors are invisible behind a transparent window — `main/index.js`
  forwards the renderer console to the terminal. Use it.

## Known state

- `renderer/App.jsx`, `renderer/animationEngine.js`, `renderer/index.jsx`,
  `utils/ttmlParser.js` and the empty `src/Lyrics/` are **dead** — superseded by
  the Spicy renderer but not yet deleted. `index.html` loads `main.ts`.
- **Romanization is broken**: `pkgs.spikerko.org` serves the engines (Kuromoji,
  pinyin, aromanize, GreekRomanization) without CORS headers, so they fail to load
  from the renderer. The fix is proxying them through the main process, per the
  rule above that the renderer makes no direct network requests.
- Design spec and implementation plan live in `docs/superpowers/`.
