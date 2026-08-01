<div align="center">
  <h1>Sweetly</h1>
  <p><b>A floating, live-synced lyrics overlay for Apple Music on macOS.</b></p>
  <p>Syllable-level karaoke lyrics that sit smoothly over your desktop — powered by spring-physics animations, WebGL album-art blur backdrops, and native macOS vibrancy glass.</p>

  <p>
    <a href="https://github.com/OpenClawdd/sweetly/releases"><img src="https://img.shields.io/badge/Platform-macOS_12%2B-black?style=for-the-badge&logo=apple&logoColor=white" alt="macOS Platform" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg?style=for-the-badge" alt="AGPL-3.0 License" /></a>
    <a href="https://electronjs.org"><img src="https://img.shields.io/badge/Electron-43-47A248?style=for-the-badge&logo=electron&logoColor=white" alt="Electron 43" /></a>
    <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-1.0%2B-fbf0df?style=for-the-badge&logo=bun&logoColor=black" alt="Bun" /></a>
  </p>

  <p>
    <a href="https://github.com/OpenClawdd/sweetly/releases"><b>📥 Download Latest Release (.dmg)</b></a>
  </p>
</div>

---

> **Notice & Attribution**  
> **Sweetly is a standalone fork of [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics) by [Spikerko](https://github.com/Spikerko)**, licensed under AGPL-3.0. The renderer UI, animation engine, and typography styling originate from Spicy Lyrics. Sweetly replaces the host platform (Spotify/Spicetify → standalone macOS Electron desktop app), swaps the player engine (`Spicetify.Player` → Apple Music via AppleScript), and adds an Apple Music catalog lyrics provider pipeline. See [NOTICE](./NOTICE) for complete details.  
> _Not affiliated with or endorsed by Spikerko, Spicy Lyrics, or Apple Inc._

---

## ✨ Features

- 🎵 **Native Apple Music Sync**: Real-time playback position tracking via AppleScript bridge with dynamic polling (300ms automix mode).
- ✨ **Word-Level Karaoke Sweeps**: Syllable-accurate timing driven by frame-rate independent spring physics.
- 🎨 **Dynamic Glass Backdrop**: WebGL GPU fragment shader blur engine rendering vibrant, dynamic album artwork backgrounds.
- ⚡ **Multi-Tiered Lyrics Pipeline**: Automatically fetches from Apple Music TTML, BiniLyrics, SpicyLyrics, LRCLIB, and Genius.
- ⚡ **Instant LRU Cache**: In-memory caching ensures zero-latency lyrics loading when re-playing tracks.
- 🖥️ **Fullscreen Cinema View**: Toggle between a floating desktop widget and a full-screen lyrics UI using **Cmd+Shift+F**.

---

## 🚀 Installation & First-Run Setup

### 1. Install App

1. Download the latest `Sweetly-*.dmg` from [Releases](https://github.com/OpenClawdd/sweetly/releases).
2. Open the `.dmg` and drag **Sweetly** to your `/Applications` folder.

### 2. AppleScript Automation Permission

1. Launch **Sweetly**.
2. Play a song in **Apple Music**.
3. When prompted by macOS for **Automation** access ("Electron wants to control Music"), click **Allow**.  
   _(If skipped, enable it manually under System Settings → Privacy & Security → Automation → Electron → Music)._

---

<details>
<summary>🔑 <b>Setting up your media-user-token (Recommended)</b></summary>

<br />

Apple Music's native syllable-level TTML (studio word timings) requires a per-user `media-user-token`. Sweetly's built-in first-run setup screen will guide you through obtaining it:

1. Open [music.apple.com](https://music.apple.com) in Safari or Chrome and sign in.
2. Open Developer Tools (`Cmd + Option + I`) → **Network** tab.
3. Click any request to `music.apple.com` and copy the `media-user-token` request header value.
4. Paste it into Sweetly's setup screen and click **Save & Launch**.

_The token is stored locally on your machine and never sent anywhere except directly to Apple Music APIs. Without it, Sweetly automatically falls back to community providers (BiniLyrics, SpicyLyrics, LRCLIB)._

</details>

---

## 🔍 Lyrics Provider Chain

Sweetly walks a prioritized provider chain on every track change to ensure you get the highest fidelity timings available:

| Tier  | Provider Source         | Supported Format         |   Sync Level    | Details                                                            |
| :---: | :---------------------- | :----------------------- | :-------------: | :----------------------------------------------------------------- |
| **1** | **Local Custom**        | `.ttml`, `.elrc`, `.lrc` | Syllable / Word | Hand-corrected or force-aligned TTML files in `~/.sweetly-custom/` |
| **2** | **Apple Music Catalog** | Native TTML XML          | Syllable / Word | Studio word timings via Apple developer API (`media-user-token`)   |
| **3** | **BiniLyrics (AMLL)**   | AMLL TTML                | Syllable / Word | Community TTML repository queried via ISRC / metadata              |
| **4** | **SpicyLyrics**         | Community TTML           | Syllable / Word | Community TTML source (optional Spotify login)                     |
| **5** | **LRCLIB**              | Enhanced LRC / LRC       |  Line-by-Line   | Crowdsourced synced lyrics database                                |
| **6** | **Apple Line-Level**    | Fallback TTML            |  Line-by-Line   | Apple Music line-synced fallback                                   |
| **7** | **Genius**              | Plain Text               |    Unsynced     | Plain text fallback display                                        |

---

## 🛠️ Development & Building

### Prerequisites

- **macOS 12+**
- **[Bun](https://bun.sh)** (`curl -fsSL https://bun.sh/install | bash`)

### Running Locally

```bash
cd spicy-apple-overlay
bun install
bun run dev
```

> _Note: `ELECTRON_DISABLE_SANDBOX=1` is required during dev so the main process can execute `osascript` to communicate with Apple Music._

### Build & Package (.dmg)

```bash
# Compile main, preload, and renderer bundles to build/
bun run build

# Package macOS ARM64 & x64 disk images to dist/
bun run dist:mac
```

### Running Tests & Quality Checks

```bash
bun run test        # Runs Vitest unit test suite (150+ tests)
bunx oxlint         # Oxlint fast linter
bunx oxfmt --check  # Code formatting check
```

---

## 📂 Project Structure

```
src/
├── main/
│   ├── index.js          # BrowserWindow management, IPC handlers, polling loop
│   ├── appleMusic.js     # AppleScript bridge & track name normalization
│   ├── appleMusicApi.js  # Apple Music catalog API client (search, TTML, artwork)
│   ├── spotifyAuth.js    # Optional Spotify PKCE OAuth for community lyrics
│   └── lyrics/           # Multi-provider chain, LRU cache, alignment pipeline
├── preload/
│   └── index.js          # contextBridge exposing secure electronAPI (CJS)
└── renderer/
    ├── main.ts           # Renderer entry point & Spicetify shim initialization
    ├── adapter/          # Bridges Apple Music state to Spicy's player interface
    ├── setup/            # First-run setup gate UI (media-user-token)
    └── lyrics/           # Renderer IPC bridge & Spicy AST normalization
```

---

## 📄 License

This project is licensed under **[AGPL-3.0](./LICENSE)** (inherited from Spicy Lyrics). Any distribution or derivative work must remain open source under AGPL-3.0 with copyright and attribution notices preserved.
