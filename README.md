# Sweetly Lyrics Overlay

A floating, always-on-top lyrics overlay for **Apple Music** on macOS. Word-by-word
karaoke lyrics, animated dynamic backgrounds, and a vibrancy-glass window that sits
over whatever you're doing.

> **This is a fork of [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics) by
> [Spikerko](https://github.com/Spikerko)**, licensed under AGPL-3.0. The renderer,
> animation system and styling are Spicy Lyrics' work. Sweetly replaces the host
> platform (Spotify/Spicetify → standalone Electron), the player source
> (`Spicetify.Player` → Apple Music via AppleScript), and adds its own lyrics
> sourcing and forced-alignment pipeline. See [NOTICE](./NOTICE) for the full list
> of changes.
>
> Spicy Lyrics is itself credited by its author as inspired by
> [Beautiful Lyrics](https://github.com/surfbryce/beautiful-lyrics).
>
> Not affiliated with or endorsed by Spikerko, Spicy Lyrics, or Apple Inc.

## Running it

```bash
bun install
bun run dev
```

The Electron sandbox must be disabled for the AppleScript bridge — `bun run dev`
already sets `ELECTRON_DISABLE_SANDBOX=1`.

**First run:** the initial `osascript` call will fail until macOS grants Automation
access to Music. Play a song to trigger the permission prompt, then enable it under
*System Settings → Privacy & Security → Automation*. Polling recovers on its own.

## Building

```bash
bun run build          # main/preload/renderer → build/
```

The Spicetify packaging target (`builds/spicy-lyrics.mjs`, configured in
`spice.config.ts`) is inherited from upstream and is not actively developed here.

## Layout

| Path | What it is |
| --- | --- |
| `src/main/` | Electron main process — window, Apple Music bridge, all network IO |
| `src/main/lyrics/` | Lyrics provider chain, track matching, alignment pipeline |
| `src/preload/` | `contextBridge` exposing `electronAPI` to the renderer |
| `src/renderer/` | Renderer entry and the Apple Music adapter |
| everything else in `src/` | Upstream Spicy Lyrics code, kept diffable against `spicy-lyrics/` |
| `spicy-lyrics/` | Clean upstream clone, used to pull and re-diff future releases |
| `scripts/align_lyrics.py` | Forced-alignment / ASR pipeline producing word-level timings |
| `docs/superpowers/specs/` | Design specs |

Since upstream code is kept unmodified, `diff -r src spicy-lyrics/src` shows exactly
what has been changed.

## License

[AGPL-3.0](./LICENSE), inherited from Spicy Lyrics. If you distribute this or a
derivative, it must remain AGPL-3.0 with source available and attribution preserved.
