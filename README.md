# Sweetly

A floating, always-on-top lyrics overlay for **Apple Music** on macOS. Word-by-word
karaoke lyrics that sit over whatever you're doing — Spring-physics animations,
blurred album-art backgrounds, and a vibrancy-glass window.

> **This is a fork of [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics) by
> [Spikerko](https://github.com/Spikerko)**, licensed under AGPL-3.0. The renderer,
> animation system and styling are Spicy Lyrics' work. Sweetly replaces the host
> platform (Spotify/Spicetify → standalone Electron), the player source
> (`Spicetify.Player` → Apple Music via AppleScript), and adds its own lyrics
> sourcing and forced-alignment pipeline. See [NOTICE](./NOTICE) for the full list
> of changes.
>
> Not affiliated with or endorsed by Spikerko, Spicy Lyrics, or Apple Inc.

## Install

Download the latest `Sweetly-*.dmg` from the [Releases](../../releases) page,
open it, and drag Sweetly into your Applications folder.

**First run:**

1. Launch Sweetly. It opens a setup screen asking for a one-time token (see below).
2. Play a song in Apple Music. macOS will ask for **Automation** access to Music —
   enable it under *System Settings → Privacy & Security → Automation*, or trigger
   the prompt by playing a song. Sweetly recovers on its own.
3. Word-level lyrics appear over whatever you're doing. Toggle fullscreen with
   **Cmd+Shift+F** or the expand button in the corner.

### The media-user-token (optional but recommended)

Apple Music's best lyrics source (native word-level TTML) requires a per-user
`media-user-token`. Sweetly's setup screen guides you through getting it in about
a minute:

1. Open [music.apple.com](https://music.apple.com) in a browser and sign in.
2. Open the Developer Console (Cmd+Opt+I) → **Network** tab.
3. Click any request to `music.apple.com` and copy the `media-user-token` header value.
4. Paste it into Sweetly's setup screen.

The token is stored locally and never leaves your Mac. Without it, Sweetly falls
back to community lyrics sources (Spicy Lyrics, BiniLyrics, LRCLIB) — still
synced, just less complete.

## Development

```bash
bun install
bun run dev
```

The Electron sandbox must be disabled for the AppleScript bridge — `bun run dev`
already sets `ELECTRON_DISABLE_SANDBOX=1`.

## Building the app

```bash
bun run build          # main/preload/renderer → build/
bun run dist:mac       # build + package arm64 & x64 .dmgs → dist/
```

`dist:mac` requires a valid Apple Developer identity for signing (falls back to
unsigned if none is configured) and produces `dist/Sweetly-<version>-arm64.dmg`
and `dist/Sweetly-<version>.dmg`.

## Layout

| Path | What it is |
| --- | --- |
| `src/main/` | Electron main process — window, Apple Music bridge, all network IO |
| `src/main/lyrics/` | Lyrics provider chain, track matching, alignment pipeline |
| `src/main/spotifyAuth.js` | Optional Spotify OAuth (PKCE) for the Spicy Lyrics community source |
| `src/preload/` | `contextBridge` exposing `electronAPI` to the renderer |
| `src/renderer/main.ts` | Renderer entry — boots the vendored Spicy UI |
| `src/renderer/adapter/` | Adapts Apple Music playback state to Spicy's player surface |
| `src/renderer/setup/` | First-run setup gate (media-user-token + Spotify sign-in) |
| everything else in `src/` | Vendored Spicy Lyrics code, kept diffable against upstream |
| `scripts/align_lyrics.py` | Forced-alignment / ASR pipeline producing word-level timings |

## How lyrics sourcing works

The main process walks a provider chain on every track change, from highest to
lowest fidelity:

1. **Custom local TTML** (`~/.sweetly-custom/`) — hand-corrected or force-aligned files
2. **Apple Music** — native word-level TTML (needs the media-user-token)
3. **BiniLyrics** — community word-level TTML
4. **Spicy Lyrics** — community TTML, requires Spotify sign-in
5. **LRCLIB** — line-synced LRC
6. **Apple Music line-level** — synced or unsynced fallback
7. **Genius** — plain text

Results are cached in memory (LRU) so re-fetching the same track is instant.

## License

[AGPL-3.0](./LICENSE), inherited from Spicy Lyrics. If you distribute this or a
derivative, it must remain AGPL-3.0 with source available and attribution preserved.
