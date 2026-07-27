# Sweetly on Spicy's renderer

**Date:** 2026-07-27
**Status:** Approved, pending implementation plan

## Goal

Make Sweetly visually and behaviourally indistinguishable from Spicy Lyrics, and
bring across the feature that distinguishes Spicy from its competitors: custom
TTML upload for songs the lyrics APIs do not cover.

The method is to stop imitating Spicy's UI and start running it. Sweetly's
renderer is replaced by Spicy's stock renderer, driven through a single adapter
that feeds it Apple Music data instead of Spotify data.

## Context

`src/` is already a copy of Spicy Lyrics 6.2.3 — `components/`, `css/`,
`utils/Lyrics/`, `modules/` are all present and unmodified. Sweetly's Electron
layer (`main/`, `preload/`, `renderer/`) was added beside it, and the live UI in
`renderer/App.jsx` re-implements from scratch what the surrounding fork already
does. `spicy-lyrics/` is a clean upstream clone at the same version.

A `diff -rq` between `src/` and `spicy-lyrics/src/` shows no divergence beyond
Sweetly's own additions, so there is no fork reconciliation to do.

Three facts make the swap tractable:

1. Spicy's lyrics core is Spotify-free. `LyricsAnimator.ts`,
   `CreateLyricsContainer.ts`, `Applyer/Synced/Line.ts`,
   `Applyer/Synced/Syllable.ts` and `Utils/Fullscreen.ts` contain zero
   `Spicetify.` references.
2. The lyrics CSS (`css/Lyrics/Mixed.css`, `css/Lyrics/main.css`) uses its own
   class names — `.LyricsContainer`, `.LyricsContent`, `.line`, `.word`,
   `.letter`, `.dot` — with no `--spice-*` or `.main-*` coupling. Spotify-specific
   selectors are confined to `default.css` and `NPVLyrics.css`, which exist to
   embed into Spotify's chrome and are not needed here.
3. `components/Global/SpotifyPlayer.ts` is a 497-line facade over
   `Spicetify.Player`. Nearly all player access in the codebase goes through it,
   making it a single clean seam.

## Licensing

Spicy Lyrics is **AGPL-3.0**. Sweetly is already a derivative work — `src/` is a
verbatim copy of Spicy 6.2.3 and the repository already carries the upstream
LICENSE file. This design does not change that status; running the renderer
explicitly rather than reimplementing it has the same licensing consequence as
the fork that already exists.

Obligations attach on distribution, not on personal use. Section 13 (remote
network interaction) is inert for a local desktop application, so in practice
AGPL-3.0 behaves as GPL-3.0 here. If distributed, the work must remain
AGPL-3.0, with source available, notices preserved, and significant changes
stated.

Handled as part of Phase 1:

- `NOTICE` added, crediting Spikerko and Spicy Lyrics, enumerating the
  significant changes, and disclaiming affiliation.
- `README.md` rewritten. It was upstream's verbatim, describing installation of
  Spicy Lyrics via the Spicetify Marketplace.
- `manifest.json` corrected. It declared `"name": "Spicy Lyrics"` with Spikerko
  as sole author. Copyright license is not trademark license: the code may be
  copied, the product identity may not be adopted.

Keeping `src/` byte-identical to upstream serves compliance directly — the diff
against `spicy-lyrics/` is the statement of changes.

## Delivery in two phases

The work splits cleanly, and each half is independently useful:

- **Phase 1 — renderer parity.** Adapter, shim, lyrics data path, Sweetly
  affordance disposition, build changes, cleanup. Ends with Sweetly
  indistinguishable from Spicy in side-by-side comparison. The custom TTML store
  is repointed here so `LyricsManager` works, but no new authoring UI is built.
- **Phase 2 — custom TTML authoring.** The three authoring paths (LRC import,
  paste-and-align, tap-to-sync editor). Depends on Phase 1 only for where the UI
  mounts.

Each phase gets its own implementation plan. Phase 1 is the larger and riskier
of the two; Phase 2 is mostly additive.

## Non-goals

- Changing the lyrics *fetching* pipeline. `main/lyrics/` keeps its sources,
  matching, and aligner.
- Supporting Spotify. The Spicetify build target is unaffected but not developed.
- Preserving Sweetly's current visual identity. It is being replaced wholesale.

## Architecture

```
main/  (role unchanged)              renderer/  (replaced)
  appleMusic.js  ──┐                   main.ts        ← new entry, models src/app.tsx
  lyrics/fetcher   ├── IPC ──►  adapter/AppleMusicPlayer.ts
  lyrics/aligner ──┘                     │  implements SpotifyPlayer's export shape
                                         ▼
                                Spicy's stock renderer, unmodified:
                                  PageView.ts · NowBar.ts · Fullscreen.ts
                                  LyricsAnimator · Line/Syllable applyers
                                  dynamicBackground.ts · SettingsPanel
                                  LyricsManager · css/Lyrics/*
```

Retired: `renderer/App.jsx` (1463 lines), `renderer/animationEngine.js` (295
lines), the 432 lines of inline CSS in `renderer/index.html`, and
`utils/ttmlParser.js`. `index.html` reduces to a mount point plus the two
existing font `<link>` tags.

A side effect worth stating: Spicy's resource efficiency is one of the two
reasons to prefer it, and this design inherits it rather than approximating it.
Sweetly's hand-rolled `animationEngine.js` and its React re-render path are
replaced by Spicy's `Maid`, `Scheduler`, `IntervalManager` and `Spring`, which
are the machinery that efficiency comes from.

## Component: the adapter

**`renderer/adapter/AppleMusicPlayer.ts`** exports the same surface as
`components/Global/SpotifyPlayer.ts`:

| Member | Backed by |
| --- | --- |
| `GetPosition`, `GetDuration` | `music-update` IPC payload |
| `GetName`, `GetAlbumName`, `GetArtists`, `GetId` | `music-update` IPC payload |
| `GetCover`, `GetCoverFrom` | artwork path from AppleScript bridge |
| `IsPlaying`, `LoopType`, `ShuffleType` | `music-update` status fields |
| `Play`, `Pause`, `TogglePlayState`, `Seek` | AppleScript via IPC |
| `Skip.Next`, `Skip.Prev` | AppleScript via IPC |

Spicy's `utils/Gets/GetProgress.ts` sits unchanged on top, so Sweetly inherits
its predicted clock, jitter filter, `PROGRESS_POSITION_OFFSET` lead and
`$playbackOffset` handling. This is expected to resolve the one-line playback lag
currently visible when Sweetly is compared side-by-side with Apple Music.

Spicy's ~40 consuming files keep importing `SpotifyPlayer` unchanged; a Vite
alias redirects the module. This keeps `src/` diffable against upstream.

## Component: the Spicetify shim

**`renderer/adapter/spicetifyShim.ts`** covers the only three APIs the retained
UI touches:

| API | Used by | Replacement |
| --- | --- | --- |
| `Tippy`, `TippyProps` | `PageView.ts` control tooltips | `tippy.js` directly |
| `Player.setShuffle`, `setRepeat` | `NowBar.ts` | existing Music.app AppleScript |
| `GraphQL.Request` | `dynamicBackground.ts` colours | canvas-based extraction from the local artwork file, returning the same `{ VIBRANT_NON_ALARMING, ... }` shape the call site expects; `dynamicBackground.ts` already has a non-GraphQL fallback to model it on |

`Global/Platform.ts`, `Global/Session.ts` and `LocalStorage` get thin
Electron-backed stand-ins over `electron-store`.

## Component: the lyrics data path

The fetch pipeline in `main/lyrics/` is unchanged. Only the handoff moves:

1. `utils/Lyrics/fetchLyrics.ts` is replaced by an Electron variant that calls
   the existing `electronAPI` bridge.
2. The result is normalised locally into Spicy's parsed shape.
3. The normalised result is passed to stock `ApplyLyrics`
   (`utils/Lyrics/Global/Applyer.ts`).

**Correction to an earlier draft of this spec.** Step 2 originally proposed
routing TTML through Spicy's `utils/Lyrics/manager/parseTTML.ts`. That is not a
local parser — it calls `Query()` against `Defaults.lyrics.api.url`, Spicy's
hosted API. Using it would send every locally-stored custom TTML to a third
party's server to be parsed, adding latency, breaking offline use, and leaning
on someone else's service for work that belongs on this machine. It is not used.

Instead, a local converter emits Spicy's shapes directly. The target types, read
from the applyers, are:

```ts
// Syllable — utils/Lyrics/Applyer/Synced/Syllable.ts
{ Type: "Syllable", StartTime: number, Content: Array<{
    Lead: { StartTime: number, EndTime: number, Syllables: Array<{
      Text: string, StartTime: number, EndTime: number,
      IsPartOfWord?: boolean, TransliteratedText?: string }> },
    Background?: Array<{ StartTime, EndTime, Syllables: [...] }>,
    OppositeAligned?: boolean }>,
  SongWriters?: string[], source?: "spt" | "spl" | "aml" }

// Line — utils/Lyrics/Applyer/Synced/Line.ts
{ Type: "Line", StartTime: number, Content: Array<{
    Text: string, StartTime: number, EndTime: number,
    TransliteratedText?: string, OppositeAligned?: boolean }> }

// Static — utils/Lyrics/Applyer/Static.ts
{ Type: "Static", Lines: Array<{ Text: string, TransliteratedText?: string }> }
```

Lyrics fetched from Spicy's own API already arrive in these shapes and need no
conversion. Only locally-sourced TTML — custom files and aligner output — goes
through the converter. `ttmlParser.js` is superseded by it and deleted.

Aligner output already passes through `main/lyrics/ttmlXml.js`, so it enters
through the same door as fetched lyrics.

## Component: custom TTML

Spicy's differentiator, and the part Sweetly currently half-duplicates.

**Store.** Spicy's `LyricsManager` UI is retained but repointed from IndexedDB
(`utils/db.ts`, `spicylyrics` → `LyricsStore`) to Sweetly's existing filesystem
store at `~/.sweetly-custom/*.ttml`, accessed over IPC. Rationale: the aligner
runs in the main process and writes there already, so one store serves both the
UI and the generator, and files stay inspectable and hand-droppable. Fuzzy key
matching stays in `main/lyrics/customKey.js`.

Note that this repoints only the *custom TTML* store. Spicy's IndexedDB layer
(`utils/db.ts`, `LyricsCacheTools.ts`) is retained for its own fetched-lyrics
cache, which backs the Cache section of the Settings panel — hence `idb` stays a
dependency. The two stores are separate and stay separate.

**Manager UI.** `components/ReactComponents/LyricsManager/` is kept as-is —
search, track rows, upload modal — with `hooks/useLyricsDB.ts` rewritten against
the IPC store. Reached through Spicy's stock `LyricsManager` ViewControl button.

**Authoring.** Three paths, ordered by cost to the user. None involve writing
XML.

1. **Import LRC or synced text.** Drop a `.lrc` (or promote an `lrclib` hit from
   the existing source) and convert to line-level TTML via `ttmlXml.js`. Cheapest
   when sync data already exists. Produces no word-level sweep on its own, but
   the result can be upgraded by running it through path 2.

2. **Paste plain lyrics, auto-align.** A second tab in `UploadTTMLModal` takes
   untimed lyrics text. The text is written to a temp file and passed to
   `scripts/align_lyrics.py --lyrics`, which already prefers its
   Qwen3-ForcedAligner path over ASR when known text is supplied — faster and
   strictly more accurate, since nothing has to be transcribed. Output is
   word-level TTML with ad-lib sub-line splitting, written to
   `~/.sweetly-custom/<key>.ttml`. This is the primary path and is mostly wiring;
   the CLI surface already exists.

3. **Tap-to-sync editor.** Fallback for tracks where audio capture fails, which
   FairPlay DRM makes common. The song plays while the user stamps timings with a
   keypress per line, with a word-level mode and the ability to scrub back and
   re-stamp. Saves as TTML. Always available, costs roughly one pass through the
   song.

Path 2 depends on audio capture succeeding; path 3 exists precisely because it
sometimes will not. Path 1 depends on external sync data existing.

## Sweetly's existing UI affordances

Stock Spicy chrome only. Nothing in the default view reveals this is not Spicy.

| Affordance | Disposition |
| --- | --- |
| Lyric offset controls | Deleted — Spicy already ships `$playbackOffset` in Settings → Playback |
| `PLAYING` / `PAUSED` label | Dropped — Spicy's NowBar conveys state |
| Transport buttons | Dropped — Spicy's NowBar provides them |
| Sync-capture pill | `sonner` toast, transient, shown only while capturing |
| Aligner controls | New section in Spicy's SettingsPanel, built with `SettingsPanel/components.tsx` so it renders natively |

Spicy ViewControls needing Electron-specific behaviour: `Close` hides the overlay
window rather than closing a Spotify page; `Fullscreen` uses Electron's
fullscreen API; `LyricsManager` opens the filesystem store above.

## Build changes

- `electron.vite.config.ts`: add TypeScript and SCSS handling for the renderer,
  plus the `SpotifyPlayer` → `AppleMusicPlayer` alias.
- `package.json`: add Spicy's runtime dependencies — `simplebar`, `sonner`,
  `nanostores`, `@nanostores/react`, `@tanstack/react-query`,
  `@tanstack/virtual-core`, `idb`, `cubic-spline`, `d3-ease`, `semver`,
  `kuroshiro`, `cyrillic-romanization`, `franc-all`, `langs`, `tippy.js`.
  `@kawarp/core` and React 19 are already present at matching versions.
- `tsconfig.json` already exists from the fork.

## Cleanup

- Delete the empty `src/Lyrics/`.
- Keep `spicy-lyrics/` as the upstream tracking clone; it is how future Spicy
  releases get pulled and re-diffed.
- After this change, everything under `src/` that is not `main/`, `preload/` or
  `renderer/` is live code rather than dead fork weight.

## Verification

Screenshot A/B against real Spicy Lyrics at matched playback positions, in all
three modes (windowed, compact, fullscreen), comparing:

- line blur ramp across distance from the active line
- active-line scale and word glow sweep timing
- scroll physics on line change
- background gradient motion
- ViewControls and NowBar geometry

Functional checks: playback offset resolves the observed one-line lag; all three
authoring paths produce TTML that `parseTTML.ts` accepts; the `Close`,
`Fullscreen`, `CompactMode` and `LyricsManager` controls behave correctly in an
Electron window.

## Risks

- **Import-time DOM polling.** `SpotifyPlayer.Playbar` runs three IIFEs at import
  that `setTimeout`-retry every 300ms forever looking for `.main-nowPlayingBar-*`
  elements, and `Platform.ts`'s `OnSpotifyReady` spins a `requestAnimationFrame`
  loop until `Spicetify.Platform` appears. Neither element nor global exists in
  Electron, so both would loop indefinitely. The adapter must stub `Playbar` and
  resolve `OnSpotifyReady` eagerly. This is a resource-efficiency bug, not just a
  correctness one, and it is easy to miss because nothing visibly breaks.
- **`PageView` container assumptions.** It attaches to a Spotify page root and
  branches on `CardMode`, `TippyMode` and PIP. The Electron window is a simpler
  container, so those branches need checking. Not load-bearing on the lyrics view.
- **Colour extraction fidelity.** Replacing `GraphQL.Request` with local artwork
  extraction may produce different background palettes than Spicy on Spotify.
  This is a place where a side-by-side could diverge.
- **Tooltip fidelity.** `Spicetify.TippyProps` carries styling Sweetly must
  reproduce for the control tooltips to match.
- **Aligner dependence on audio capture.** Paths 2 and 3 exist as a pair
  specifically because DRM makes capture unreliable; if capture regresses, path 3
  is the only word-level route.
