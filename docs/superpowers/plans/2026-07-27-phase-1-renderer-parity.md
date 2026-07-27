# Phase 1: Renderer Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Sweetly's hand-rolled lyrics UI with Spicy Lyrics' stock renderer, driven by an adapter that feeds it Apple Music data, so the two are indistinguishable side-by-side.

**Architecture:** Spicy's renderer code under `src/` stays byte-identical to upstream. A new `src/renderer/adapter/` layer implements the same export surface as `src/components/Global/SpotifyPlayer.ts` on top of the existing `electronAPI` IPC bridge, and installs a minimal `globalThis.Spicetify` shim covering the three APIs the retained UI touches. A Vite alias redirects Spicy's `SpotifyPlayer` imports to the adapter, so no upstream file is edited.

**Tech Stack:** Electron 43, electron-vite 5, React 19, TypeScript, Bun (runtime + test runner), Spicy Lyrics 6.2.3 (AGPL-3.0).

## Global Constraints

- **Never edit files under `src/` other than `main/`, `preload/`, `renderer/`.** Upstream code stays byte-identical so `diff -r src spicy-lyrics/src` remains the statement of changes required by AGPL-3.0. Every behavioural change goes in the adapter or the Vite config.
- **License: AGPL-3.0.** Preserve all copyright notices. Do not reintroduce "Spicy Lyrics" as this project's identity in `README.md`, `manifest.json`, or window titles.
- **Never call `Defaults.lyrics.api.url` for local content.** `utils/Lyrics/manager/parseTTML.ts` is a remote call to Spicy's hosted API; locally-sourced TTML is converted on-device.
- **Package manager is `bun`**, not npm/npx/node. Source is ESM (`"type": "module"`).
- **Renderer never makes network requests directly.** All Spotify/spicylyrics/Apple IO routes through the main process over IPC.
- Existing preload surface, already available as `window.electronAPI` and not to be re-derived: `onMusicUpdate(cb)`, `onLyricsUpdated(cb)`, `onAlignStatus(cb)`, `getInitialState()`, `toggleFullscreen()`, `fetchLyrics(payload)`, `setMediaUserToken(token)`, `saveCustomLyrics(name, artist, ttml)`, `seekTo(seconds)`, `togglePlayPause()`, `nextTrack()`, `previousTrack()`, `toggleShuffle()`, `cycleRepeat()`, `toggleFavorite()`.
- The `music-update` IPC payload shape, emitted by `src/main/appleMusic.js:122-136`:

```js
{
  status: "playing" | "paused" | "stopped" | "closed",
  track: null | {
    name: string, nameCleaned: string,
    artist: string, artistCleaned: string,
    album: string,
    position: number,   // SECONDS, float
    duration: number,   // SECONDS, float
  },
  shuffle: boolean,
  repeat: "off" | "one" | "all",
  favorited: boolean,
}
```

**Units warning:** Apple Music reports seconds. Spicy expects **milliseconds** throughout (`GetDuration()` returns `duration.milliseconds`; `GetProgress` works in ms). The adapter converts at the boundary — this is the single most likely source of a subtle sync bug.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `src/renderer/adapter/musicState.ts` | Holds the latest `music-update` payload; pure accessors. No Spicy knowledge. |
| `src/renderer/adapter/AppleMusicPlayer.ts` | Implements `SpotifyPlayer`'s export surface over `musicState`. Aliased in place of upstream's module. |
| `src/renderer/adapter/spicetifyShim.ts` | Installs `globalThis.Spicetify` with `Tippy`, `Player.setShuffle/setRepeat`, `GraphQL.Request`, `LocalStorage`. |
| `src/renderer/adapter/platformShim.ts` | Replaces `Global/Platform.ts`; resolves `OnSpotifyReady` immediately. |
| `src/renderer/adapter/artworkColors.ts` | Canvas-based dominant-colour extraction, returns the shape `dynamicBackground.ts` expects. |
| `src/renderer/lyrics/toSpicyShape.ts` | Converts local TTML into Spicy's `Syllable`/`Line`/`Static` shapes. |
| `src/renderer/lyrics/fetchLyricsElectron.ts` | IPC → `toSpicyShape` → stock `ApplyLyrics`. |
| `src/renderer/main.ts` | Renderer entry, modelled on `src/app.tsx` minus Spotify-embedding. |
| `tests/adapter/*.test.ts`, `tests/lyrics/*.test.ts` | Bun unit tests. |

**Modified:** `electron.vite.config.ts`, `package.json`, `src/renderer/index.html`, `tsconfig.json`.

**Deleted (Task 11):** `src/renderer/App.jsx`, `src/renderer/animationEngine.js`, `src/renderer/index.jsx`, `src/utils/ttmlParser.js`, `src/Lyrics/` (empty).

---

### Task 1: Dependencies, TypeScript and SCSS in the renderer build

**Files:**
- Modify: `package.json`
- Modify: `electron.vite.config.ts`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a renderer build that compiles `.ts`/`.tsx`/`.scss`, and `bun test` as the test command. No source changes yet — the app must still run on the old `App.jsx` at the end of this task.

- [ ] **Step 1: Install Spicy's runtime dependencies**

```bash
bun add simplebar sonner nanostores @nanostores/react @tanstack/react-query \
  @tanstack/virtual-core idb cubic-spline d3-ease semver kuroshiro \
  cyrillic-romanization franc-all langs tippy.js
bun add -d sass @types/d3-ease @types/semver typescript
```

`@kawarp/core` and `react`/`react-dom` 19 are already present at versions matching upstream — do not touch them.

- [ ] **Step 2: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "bun test"
```

- [ ] **Step 3: Configure the renderer build**

Replace `electron.vite.config.ts` with:

```ts
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: { outDir: "build/main" },
  },
  preload: {
    build: {
      outDir: "build/preload",
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.js",
        },
      },
    },
  },
  renderer: {
    build: { outDir: "build/renderer" },
    plugins: [react()],
    resolve: {
      alias: [
        // Upstream Spicy files import SpotifyPlayer by relative path from many
        // depths. Match the module suffix rather than a single absolute path so
        // no upstream file has to be edited. See the Global Constraints.
        {
          find: /^(.*)\/components\/Global\/SpotifyPlayer\.ts$/,
          replacement: resolve(__dirname, "src/renderer/adapter/AppleMusicPlayer.ts"),
        },
        {
          find: /^(.*)\/components\/Global\/Platform\.ts$/,
          replacement: resolve(__dirname, "src/renderer/adapter/platformShim.ts"),
        },
      ],
    },
  },
});
```

- [ ] **Step 4: Verify the build still works unchanged**

Run: `bun run build`
Expected: exits 0, `build/renderer/` is produced. The aliases point at files that do not exist yet, but nothing imports them yet either, so Rollup never resolves them.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock electron.vite.config.ts tsconfig.json
git commit -m "build: add Spicy runtime deps, TS/SCSS and adapter aliases to renderer"
```

---

### Task 2: Music state store

**Files:**
- Create: `src/renderer/adapter/musicState.ts`
- Test: `tests/adapter/musicState.test.ts`

**Interfaces:**
- Consumes: the `music-update` payload documented in Global Constraints.
- Produces:
  - `type MusicState` — the payload type.
  - `subscribeMusicState(): () => void` — wires `electronAPI.onMusicUpdate`, returns an unsubscribe.
  - `getMusicState(): MusicState` — latest payload, never null.
  - `setMusicStateForTest(state: MusicState): void` — test seam.
  - `onMusicStateChange(cb: (s: MusicState) => void): () => void` — change notification, returns unsubscribe.
  - `EMPTY_STATE: MusicState` — the closed/no-track default.

- [ ] **Step 1: Write the failing test**

Create `tests/adapter/musicState.test.ts`:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import {
  EMPTY_STATE,
  getMusicState,
  setMusicStateForTest,
  onMusicStateChange,
} from "../../src/renderer/adapter/musicState.ts";

const PLAYING = {
  status: "playing" as const,
  track: {
    name: "Sloppy Joe", nameCleaned: "Sloppy Joe",
    artist: "slayr", artistCleaned: "slayr",
    album: "BLOODLUXX", position: 47.5, duration: 147,
  },
  shuffle: false, repeat: "off" as const, favorited: false,
};

beforeEach(() => setMusicStateForTest(EMPTY_STATE));

describe("musicState", () => {
  test("defaults to a closed state with no track", () => {
    expect(getMusicState().status).toBe("closed");
    expect(getMusicState().track).toBeNull();
  });

  test("stores the most recent payload", () => {
    setMusicStateForTest(PLAYING);
    expect(getMusicState().track?.name).toBe("Sloppy Joe");
    expect(getMusicState().track?.position).toBe(47.5);
  });

  test("notifies subscribers on change", () => {
    const seen: string[] = [];
    onMusicStateChange((s) => seen.push(s.status));
    setMusicStateForTest(PLAYING);
    expect(seen).toEqual(["playing"]);
  });

  test("unsubscribe stops notifications", () => {
    const seen: string[] = [];
    const off = onMusicStateChange((s) => seen.push(s.status));
    off();
    setMusicStateForTest(PLAYING);
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/adapter/musicState.test.ts`
Expected: FAIL — cannot resolve `src/renderer/adapter/musicState.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/adapter/musicState.ts`:

```ts
export type MusicTrack = {
  name: string;
  nameCleaned: string;
  artist: string;
  artistCleaned: string;
  album: string;
  /** SECONDS. Apple Music's unit. Convert before handing to Spicy. */
  position: number;
  /** SECONDS. Apple Music's unit. Convert before handing to Spicy. */
  duration: number;
};

export type MusicState = {
  status: "playing" | "paused" | "stopped" | "closed";
  track: MusicTrack | null;
  shuffle: boolean;
  repeat: "off" | "one" | "all";
  favorited: boolean;
};

export const EMPTY_STATE: MusicState = {
  status: "closed",
  track: null,
  shuffle: false,
  repeat: "off",
  favorited: false,
};

let current: MusicState = EMPTY_STATE;
const listeners = new Set<(s: MusicState) => void>();

function publish(state: MusicState): void {
  current = state;
  for (const listener of listeners) listener(state);
}

export function getMusicState(): MusicState {
  return current;
}

export function onMusicStateChange(cb: (s: MusicState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Test seam. Production code goes through subscribeMusicState. */
export function setMusicStateForTest(state: MusicState): void {
  publish(state);
}

export function subscribeMusicState(): () => void {
  const api = (globalThis as any).electronAPI;
  if (!api?.onMusicUpdate) return () => {};
  return api.onMusicUpdate((state: MusicState) => publish(state)) ?? (() => {});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/adapter/musicState.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/adapter/musicState.ts tests/adapter/musicState.test.ts
git commit -m "feat(adapter): music state store fed by music-update IPC"
```

---

### Task 3: AppleMusicPlayer

**Files:**
- Create: `src/renderer/adapter/AppleMusicPlayer.ts`
- Test: `tests/adapter/AppleMusicPlayer.test.ts`
- Read for reference (do not edit): `src/components/Global/SpotifyPlayer.ts`

**Interfaces:**
- Consumes: `getMusicState`, `MusicState` from Task 2.
- Produces: `export const SpotifyPlayer` — same name as upstream, because the alias substitutes this module for `components/Global/SpotifyPlayer.ts` and consumers do `import { SpotifyPlayer } from ".../SpotifyPlayer.ts"`. Also re-exports `type CoverSizes` and `type Artist`.

**Critical:** upstream's `SpotifyPlayer.Playbar` is an IIFE that `setTimeout`-retries every 300ms forever hunting for `.main-nowPlayingBar-right`. It must be replaced by inert stubs, or the app burns a timer for its whole lifetime.

- [ ] **Step 1: Write the failing test**

Create `tests/adapter/AppleMusicPlayer.test.ts`:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { EMPTY_STATE, setMusicStateForTest } from "../../src/renderer/adapter/musicState.ts";
import { SpotifyPlayer } from "../../src/renderer/adapter/AppleMusicPlayer.ts";

const PLAYING = {
  status: "playing" as const,
  track: {
    name: "If We Being Rëal", nameCleaned: "If We Being Rëal",
    artist: "Yeat", artistCleaned: "Yeat",
    album: "2093", position: 111, duration: 172,
  },
  shuffle: true, repeat: "all" as const, favorited: false,
};

beforeEach(() => setMusicStateForTest(EMPTY_STATE));

describe("AppleMusicPlayer", () => {
  test("converts duration from seconds to milliseconds", () => {
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.GetDuration()).toBe(172_000);
  });

  test("returns 0 duration when nothing is loaded", () => {
    expect(SpotifyPlayer.GetDuration()).toBe(0);
  });

  test("exposes track metadata", () => {
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.GetName()).toBe("If We Being Rëal");
    expect(SpotifyPlayer.GetAlbumName()).toBe("2093");
    expect(SpotifyPlayer.GetArtists()?.[0]?.name).toBe("Yeat");
  });

  test("derives a stable id from cleaned name and artist", () => {
    setMusicStateForTest(PLAYING);
    const first = SpotifyPlayer.GetId();
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.GetId()).toBe(first);
    expect(first).toContain("yeat");
  });

  test("id changes when the track changes", () => {
    setMusicStateForTest(PLAYING);
    const first = SpotifyPlayer.GetId();
    setMusicStateForTest({ ...PLAYING, track: { ...PLAYING.track, nameCleaned: "Other" } });
    expect(SpotifyPlayer.GetId()).not.toBe(first);
  });

  test("reflects shuffle and repeat state", () => {
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.ShuffleType).toBe("smart");
    expect(SpotifyPlayer.LoopType).toBe("all");
  });

  test("IsPlaying tracks status", () => {
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.IsPlaying).toBe(true);
    setMusicStateForTest({ ...PLAYING, status: "paused" });
    expect(SpotifyPlayer.IsPlaying).toBe(false);
  });

  test("is never a DJ session and never a podcast", () => {
    setMusicStateForTest(PLAYING);
    expect(SpotifyPlayer.IsDJ()).toBe(false);
    expect(SpotifyPlayer.GetContentType()).toBe("track");
  });

  test("Playbar stubs construct without touching the DOM or scheduling timers", () => {
    const button = new SpotifyPlayer.Playbar.Button("Label", "icon");
    expect(button.element.tagName).toBe("BUTTON");
    expect(() => button.register()).not.toThrow();
    expect(() => button.deregister()).not.toThrow();
  });

  test("falls back to a placeholder cover when no artwork is present", () => {
    expect(SpotifyPlayer.GetCover("large")).toContain("SongPlaceholder");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/adapter/AppleMusicPlayer.test.ts`
Expected: FAIL — cannot resolve `AppleMusicPlayer.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/adapter/AppleMusicPlayer.ts`:

```ts
/**
 * Apple Music implementation of upstream's SpotifyPlayer surface.
 *
 * The Vite config aliases `components/Global/SpotifyPlayer.ts` to this file, so
 * every upstream consumer keeps its original import and upstream stays
 * byte-identical. The export is therefore still named `SpotifyPlayer`.
 *
 * Units: Apple Music reports seconds; Spicy expects milliseconds everywhere.
 * Conversion happens here and nowhere else.
 */
import GetProgress, { _DEPRECATED___GetProgress } from "../../utils/Gets/GetProgress.ts";
import { getMusicState } from "./musicState.ts";

export type CoverSizes = "standard" | "small" | "large" | "xlarge";
export type Artist = { type: "artist"; name: string; uri: string };

const PLACEHOLDER = "https://images.spikerko.org/SongPlaceholderFull.png";

/**
 * Artwork arrives on the fetch-lyrics response as `artworkUrl`, not on the
 * music-update payload — AppleScript gives us no image. Task 6 sets this.
 */
let artworkUrl: string | null = null;
export function setArtworkUrl(url: string | null): void {
  artworkUrl = url;
}
export function getArtworkUrl(): string | null {
  return artworkUrl;
}

const api = () => (globalThis as any).electronAPI ?? {};

/** Stable per-track identifier. Apple Music has no URI, so derive one. */
function trackId(): string | undefined {
  const track = getMusicState().track;
  if (!track) return undefined;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug(track.artistCleaned)}--${slug(track.nameCleaned)}`;
}

/**
 * Upstream's Playbar mounts buttons into Spotify's now-playing bar, retrying on
 * a 300ms timer until that DOM appears. It never appears here, so these are
 * inert stubs — same constructor shape, no timers, no DOM queries.
 */
const InertPlaybar = (() => {
  class Button {
    public element: HTMLButtonElement;
    public iconElement: HTMLSpanElement;
    public tippy: any = null;
    private _label: string;
    private _icon: string;
    private _onClick: (b: Button) => void;
    private _disabled = false;
    private _active = false;

    constructor(
      label: string,
      icon: string,
      onClick: (b: Button) => void = () => {},
      disabled = false,
      active = false,
    ) {
      this.element = document.createElement("button");
      this.iconElement = document.createElement("span");
      this.element.appendChild(this.iconElement);
      this._label = label;
      this._icon = icon;
      this._onClick = onClick;
      this._disabled = disabled;
      this._active = active;
      this.element.setAttribute("title", label);
      this.iconElement.innerHTML = icon;
    }
    get label() { return this._label; }
    set label(text: string) { this._label = text; this.element.setAttribute("title", text); }
    get icon() { return this._icon; }
    set icon(input: string) { this._icon = input; this.iconElement.innerHTML = input; }
    get onClick() { return this._onClick; }
    set onClick(fn: (b: Button) => void) { this._onClick = fn; this.element.onclick = () => fn(this); }
    get disabled() { return this._disabled; }
    set disabled(v: boolean) { this._disabled = v; this.element.disabled = v; }
    get active() { return this._active; }
    set active(v: boolean) { this._active = v; }
    register() {}
    deregister() { this.element.remove(); }
  }
  class Widget extends Button {}
  return { Button, Widget };
})();

export const SpotifyPlayer = {
  get IsPlaying(): boolean {
    return getMusicState().status === "playing";
  },
  _DEPRECATED_: { GetTrackPosition: _DEPRECATED___GetProgress },
  GetPosition: GetProgress,
  GetContentType: (): string => "track",
  GetMediaType: (): string => "audio",
  GetDuration: (): number => {
    const track = getMusicState().track;
    return track ? Math.round(track.duration * 1000) : 0;
  },
  /** Raw player position in ms, before GetProgress's smoothing. */
  GetRawPosition: (): number => {
    const track = getMusicState().track;
    return track ? track.position * 1000 : 0;
  },
  Seek: (position: number): void => {
    api().seekTo?.(position / 1000);
  },
  GetCover: (_size: CoverSizes): string | undefined => getArtworkUrl() || PLACEHOLDER,
  GetCoverFrom: (
    size: CoverSizes,
    source: Array<{ url: string; label: string }>,
  ): string | undefined => {
    if (source?.length > 0) {
      return source.find((cover) => cover.label === size)?.url ?? PLACEHOLDER;
    }
    return PLACEHOLDER;
  },
  GetName: (): string | undefined => getMusicState().track?.name,
  GetShowName: (): string | undefined => undefined,
  GetAlbumName: (): string | undefined => getMusicState().track?.album,
  GetId: trackId,
  GetArtists: (): Artist[] | undefined => {
    const track = getMusicState().track;
    if (!track) return undefined;
    return [{ type: "artist", name: track.artist, uri: `apple:artist:${track.artistCleaned}` }];
  },
  GetUri: (): string | undefined => {
    const id = trackId();
    return id ? `apple:track:${id}` : undefined;
  },
  Pause: () => api().togglePlayPause?.(),
  Play: () => api().togglePlayPause?.(),
  TogglePlayState: () => api().togglePlayPause?.(),
  Skip: {
    Next: () => api().nextTrack?.(),
    Prev: () => api().previousTrack?.(),
  },
  get LoopType(): string {
    return getMusicState().repeat;
  },
  get ShuffleType(): string {
    return getMusicState().shuffle ? "smart" : "none";
  },
  IsDJ: (): boolean => false,
  IsLiked: (): boolean => getMusicState().favorited,
  ToggleLike: async (): Promise<void> => {
    await api().toggleFavorite?.();
  },
  Playbar: InertPlaybar,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/adapter/AppleMusicPlayer.test.ts`
Expected: PASS, 10 tests.

If `GetProgress.ts` fails to import under Bun because it reaches for `Spicetify`, that is expected — Task 4 installs the shim. If it blocks this task, temporarily import the module lazily inside `GetPosition` and note it; Task 4 removes the need.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/adapter/AppleMusicPlayer.ts tests/adapter/AppleMusicPlayer.test.ts
git commit -m "feat(adapter): AppleMusicPlayer implementing SpotifyPlayer's surface"
```

---

### Task 4: Spicetify shim and Platform replacement

**Files:**
- Create: `src/renderer/adapter/spicetifyShim.ts`
- Create: `src/renderer/adapter/platformShim.ts`
- Create: `src/renderer/adapter/artworkColors.ts`
- Test: `tests/adapter/spicetifyShim.test.ts`

**Interfaces:**
- Consumes: `getMusicState` (Task 2).
- Produces:
  - `installSpicetifyShim(): void` — idempotent; sets `globalThis.Spicetify`. Must run before any upstream module is imported.
  - `extractColors(imageUrl: string): Promise<{ VIBRANT_NON_ALARMING: string; VIBRANT: string; DESATURATED: string; LIGHT_VIBRANT: string; PROMINENT: string }>` from `artworkColors.ts`.
  - `platformShim.ts` default-exports `{ OnSpotifyReady: Promise<void>, GetSpotifyAccessToken: () => Promise<string>, SpotifyVersion: number[] }`.

- [ ] **Step 1: Write the failing test**

Create `tests/adapter/spicetifyShim.test.ts`:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { installSpicetifyShim } from "../../src/renderer/adapter/spicetifyShim.ts";

beforeEach(() => {
  delete (globalThis as any).Spicetify;
  installSpicetifyShim();
});

describe("spicetifyShim", () => {
  test("defines the global", () => {
    expect((globalThis as any).Spicetify).toBeDefined();
  });

  test("Tippy returns a controllable handle", () => {
    const el = document.createElement("button");
    const instance = (globalThis as any).Spicetify.Tippy(el, { content: "Close" });
    expect(typeof instance.setContent).toBe("function");
    expect(typeof instance.destroy).toBe("function");
  });

  test("TippyProps is an object so spreading it is safe", () => {
    expect(typeof (globalThis as any).Spicetify.TippyProps).toBe("object");
  });

  test("Player control methods exist and do not throw", () => {
    const player = (globalThis as any).Spicetify.Player;
    expect(() => player.setShuffle(true)).not.toThrow();
    expect(() => player.setRepeat(2)).not.toThrow();
  });

  test("LocalStorage round-trips values", () => {
    const ls = (globalThis as any).Spicetify.LocalStorage;
    ls.set("sweetly:test", "value");
    expect(ls.get("sweetly:test")).toBe("value");
  });

  test("LocalStorage returns null for unset keys", () => {
    expect((globalThis as any).Spicetify.LocalStorage.get("sweetly:absent")).toBeNull();
  });

  test("installing twice does not replace the existing global", () => {
    const first = (globalThis as any).Spicetify;
    installSpicetifyShim();
    expect((globalThis as any).Spicetify).toBe(first);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/adapter/spicetifyShim.test.ts`
Expected: FAIL — cannot resolve `spicetifyShim.ts`.

- [ ] **Step 3: Write artworkColors.ts**

```ts
/**
 * Local replacement for Spicetify.GraphQL getDynamicColorsByUris.
 *
 * dynamicBackground.ts expects an object of hex strings under these keys. We
 * derive them on-device from the artwork rather than asking a remote service,
 * which also means backgrounds still work offline.
 */
export type ExtractedColors = {
  VIBRANT_NON_ALARMING: string;
  VIBRANT: string;
  DESATURATED: string;
  LIGHT_VIBRANT: string;
  PROMINENT: string;
};

const FALLBACK: ExtractedColors = {
  VIBRANT_NON_ALARMING: "#999999",
  VIBRANT: "#999999",
  DESATURATED: "#7a7a7a",
  LIGHT_VIBRANT: "#c4c4c4",
  PROMINENT: "#999999",
};

const cache = new Map<string, ExtractedColors>();

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function adjust(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 0xff) * factor);
  const g = Math.min(255, ((n >> 8) & 0xff) * factor);
  const b = Math.min(255, (n & 0xff) * factor);
  return toHex(r, g, b);
}

function desaturate(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (c: number) => c * 0.4 + grey * 0.6;
  return toHex(mix(r), mix(g), mix(b));
}

export async function extractColors(imageUrl: string): Promise<ExtractedColors> {
  if (!imageUrl) return FALLBACK;
  const cached = cache.get(imageUrl);
  if (cached) return cached;

  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("artwork load failed"));
      image.src = imageUrl;
    });

    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return FALLBACK;
    ctx.drawImage(image, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    // Pick the most saturated reasonably-bright pixel: the same intent as
    // Spotify's VIBRANT_NON_ALARMING, which avoids near-black and near-white.
    let best = { score: -1, r: 153, g: 153, b: 153 };
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (data[i + 3] < 128) continue;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lightness = (max + min) / 2;
      if (lightness < 40 || lightness > 225) continue;
      const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
      const score = saturation * 100 + lightness * 0.1;
      if (score > best.score) best = { score, r, g, b };
    }

    const vibrant = toHex(best.r, best.g, best.b);
    const colors: ExtractedColors = {
      VIBRANT_NON_ALARMING: vibrant,
      VIBRANT: vibrant,
      DESATURATED: desaturate(vibrant),
      LIGHT_VIBRANT: adjust(vibrant, 1.35),
      PROMINENT: vibrant,
    };
    cache.set(imageUrl, colors);
    return colors;
  } catch {
    return FALLBACK;
  }
}
```

- [ ] **Step 4: Write platformShim.ts**

```ts
/**
 * Replaces components/Global/Platform.ts, which otherwise spins a
 * requestAnimationFrame loop forever waiting for Spicetify.Platform.
 *
 * There is no Spotify session here, so OnSpotifyReady resolves immediately and
 * the access-token path is never used — the main process owns all network IO.
 */
const Platform = {
  OnSpotifyReady: Promise.resolve(),
  GetSpotifyAccessToken: (): Promise<string> => Promise.resolve(""),
  get SpotifyVersion(): number[] {
    return [1, 2, 0];
  },
};

export default Platform;
```

- [ ] **Step 5: Write spicetifyShim.ts**

```ts
/**
 * Minimal globalThis.Spicetify covering only what the retained UI touches:
 *   Tippy / TippyProps  — PageView.ts control tooltips
 *   Player.setShuffle / setRepeat — NowBar.ts
 *   GraphQL.Request     — dynamicBackground.ts colour lookup
 *   LocalStorage        — settings persistence
 *
 * MUST run before any upstream module is imported, because several read
 * Spicetify at module scope.
 */
import tippy from "tippy.js";
import { extractColors } from "./artworkColors.ts";

export const TIPPY_PROPS = {
  theme: "spicy",
  animation: "scale",
  duration: [150, 100] as [number, number],
  delay: [200, 0] as [number, number],
  arrow: true,
  placement: "top" as const,
};

const api = () => (globalThis as any).electronAPI ?? {};

export function installSpicetifyShim(): void {
  if ((globalThis as any).Spicetify) return;

  (globalThis as any).Spicetify = {
    Tippy: (element: Element, props: Record<string, unknown>) =>
      tippy(element as HTMLElement, { ...TIPPY_PROPS, ...props }),
    TippyProps: TIPPY_PROPS,

    Player: {
      setShuffle: (_enabled: boolean) => api().toggleShuffle?.(),
      // Upstream calls setRepeat(0|1|2). Music.app only exposes a cycle, so
      // step it until it lands on the requested mode; the poller reports back.
      setRepeat: (_mode: number) => api().cycleRepeat?.(),
      addEventListener: () => {},
      removeEventListener: () => {},
      data: null,
    },

    GraphQL: {
      Definitions: { getDynamicColorsByUris: "getDynamicColorsByUris" },
      Request: async (_definition: unknown, variables: any) => {
        const colors = await extractColors(variables?.imageUrl ?? "");
        return { data: { extractedColors: [{ colorRaw: { hex: colors.VIBRANT_NON_ALARMING }, ...colors }] } };
      },
    },

    LocalStorage: {
      get: (key: string): string | null => globalThis.localStorage?.getItem(key) ?? null,
      set: (key: string, value: string): void => globalThis.localStorage?.setItem(key, value),
      remove: (key: string): void => globalThis.localStorage?.removeItem(key),
    },

    Platform: { version: "1.2.0", History: { push: () => {}, goBack: () => {}, listen: () => () => {} } },
    Keyboard: { registerImportantShortcut: () => {}, ValidKeys: {} },
    CosmosAsync: { get: async () => ({}), post: async () => ({}) },
    ReactComponent: {},
    SVGIcons: {},
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/adapter/spicetifyShim.test.ts`
Expected: PASS, 7 tests. Bun provides a DOM via happy-dom; if `document` is undefined, add `--dom` or install `@happy-dom/global-registrator` and register it in a `tests/setup.ts` referenced from `bunfig.toml` with `preload = ["./tests/setup.ts"]`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/adapter/spicetifyShim.ts src/renderer/adapter/platformShim.ts \
        src/renderer/adapter/artworkColors.ts tests/adapter/spicetifyShim.test.ts
git commit -m "feat(adapter): Spicetify shim, Platform replacement, local colour extraction"
```

---

### Task 5: Local TTML → Spicy shape converter

**Files:**
- Create: `src/renderer/lyrics/toSpicyShape.ts`
- Test: `tests/lyrics/toSpicyShape.test.ts`
- Read for reference (do not edit): `src/utils/Lyrics/Applyer/Synced/Syllable.ts:33-67`, `src/utils/Lyrics/Applyer/Synced/Line.ts:29-46`, `src/utils/Lyrics/Applyer/Static.ts:28-38`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `parseLocalTTML(ttml: string): SpicyLyrics | null`
  - `type SpicyLyrics = SyllableLyrics | LineLyrics | StaticLyrics` matching the three shapes in the spec.

TTML times are `mm:ss.SSS`, `ss.SSS`, or `hh:mm:ss.SSS`. Spicy wants **milliseconds** as numbers. A `<span>` with `ttm:role="x-bg"` is a background vocal; nested spans with `begin`/`end` are syllables; `IsPartOfWord` is true when a syllable is not followed by whitespace in the source.

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/toSpicyShape.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseLocalTTML, parseTTMLTime } from "../../src/renderer/lyrics/toSpicyShape.ts";

const SYLLABLE_TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word">
  <body>
    <div>
      <p begin="00:12.500" end="00:15.000">
        <span begin="00:12.500" end="00:12.900">I </span>
        <span begin="00:12.900" end="00:13.400">step </span>
        <span begin="00:13.400" end="00:14.000">on</span>
        <span ttm:role="x-bg" begin="00:14.100" end="00:15.000">
          <span begin="00:14.100" end="00:15.000">yeah</span>
        </span>
      </p>
    </div>
  </body>
</tt>`;

const LINE_TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" itunes:timing="Line">
  <body><div>
    <p begin="00:10.000" end="00:12.000">If we being real</p>
    <p begin="00:12.000" end="00:14.500">I don't know how to feel</p>
  </div></body>
</tt>`;

const STATIC_TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body><div>
    <p>If we being real</p>
    <p>I don't know how to feel</p>
  </div></body>
</tt>`;

describe("parseTTMLTime", () => {
  test("parses mm:ss.SSS to milliseconds", () => {
    expect(parseTTMLTime("00:12.500")).toBe(12_500);
  });
  test("parses hh:mm:ss.SSS to milliseconds", () => {
    expect(parseTTMLTime("01:02:03.250")).toBe(3_723_250);
  });
  test("parses bare seconds", () => {
    expect(parseTTMLTime("7.25")).toBe(7_250);
  });
  test("returns 0 for junk", () => {
    expect(parseTTMLTime("")).toBe(0);
  });
});

describe("parseLocalTTML", () => {
  test("produces Syllable type when spans carry timings", () => {
    const result = parseLocalTTML(SYLLABLE_TTML)!;
    expect(result.Type).toBe("Syllable");
  });

  test("maps lead syllables with millisecond timings", () => {
    const result: any = parseLocalTTML(SYLLABLE_TTML);
    const syllables = result.Content[0].Lead.Syllables;
    expect(syllables[0].Text).toBe("I");
    expect(syllables[0].StartTime).toBe(12_500);
    expect(syllables[0].EndTime).toBe(12_900);
    expect(syllables).toHaveLength(3);
  });

  test("marks IsPartOfWord false when a space follows the syllable", () => {
    const result: any = parseLocalTTML(SYLLABLE_TTML);
    expect(result.Content[0].Lead.Syllables[0].IsPartOfWord).toBe(false);
  });

  test("separates x-bg spans into Background", () => {
    const result: any = parseLocalTTML(SYLLABLE_TTML);
    expect(result.Content[0].Background).toHaveLength(1);
    expect(result.Content[0].Background[0].Syllables[0].Text).toBe("yeah");
  });

  test("sets StartTime to the first line's start", () => {
    const result: any = parseLocalTTML(SYLLABLE_TTML);
    expect(result.StartTime).toBe(12_500);
  });

  test("produces Line type when only p elements carry timings", () => {
    const result: any = parseLocalTTML(LINE_TTML);
    expect(result.Type).toBe("Line");
    expect(result.Content[0].Text).toBe("If we being real");
    expect(result.Content[0].StartTime).toBe(10_000);
    expect(result.Content[1].EndTime).toBe(14_500);
  });

  test("produces Static type when nothing carries timings", () => {
    const result: any = parseLocalTTML(STATIC_TTML);
    expect(result.Type).toBe("Static");
    expect(result.Lines).toHaveLength(2);
    expect(result.Lines[0].Text).toBe("If we being real");
  });

  test("returns null for unparseable input", () => {
    expect(parseLocalTTML("not xml at all <<<")).toBeNull();
  });

  test("returns null for TTML with no lines", () => {
    expect(parseLocalTTML(`<tt><body><div></div></body></tt>`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/lyrics/toSpicyShape.test.ts`
Expected: FAIL — cannot resolve `toSpicyShape.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/lyrics/toSpicyShape.ts`:

```ts
/**
 * Converts locally-sourced TTML into the shapes Spicy's applyers consume.
 *
 * Deliberately local: upstream's utils/Lyrics/manager/parseTTML.ts posts the
 * document to Spicy's hosted API. Custom files and aligner output are ours and
 * stay on this machine.
 *
 * All emitted times are MILLISECONDS, matching what the applyers expect.
 */

export type Syllable = {
  Text: string;
  StartTime: number;
  EndTime: number;
  IsPartOfWord?: boolean;
  TransliteratedText?: string;
};

export type VocalGroup = { StartTime: number; EndTime: number; Syllables: Syllable[] };

export type SyllableLyrics = {
  Type: "Syllable";
  StartTime: number;
  Content: Array<{ Lead: VocalGroup; Background?: VocalGroup[]; OppositeAligned?: boolean }>;
};

export type LineLyrics = {
  Type: "Line";
  StartTime: number;
  Content: Array<{ Text: string; StartTime: number; EndTime: number; OppositeAligned?: boolean }>;
};

export type StaticLyrics = {
  Type: "Static";
  Lines: Array<{ Text: string }>;
};

export type SpicyLyrics = SyllableLyrics | LineLyrics | StaticLyrics;

/** `hh:mm:ss.SSS`, `mm:ss.SSS` or `ss.SSS` → milliseconds. */
export function parseTTMLTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parts = value.trim().split(":");
  if (parts.some((p) => p === "" || Number.isNaN(Number(p)))) return 0;
  let seconds = 0;
  if (parts.length === 3) {
    seconds = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  } else if (parts.length === 2) {
    seconds = Number(parts[0]) * 60 + Number(parts[1]);
  } else {
    seconds = Number(parts[0]);
  }
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

function isBackground(span: Element): boolean {
  return (
    span.getAttribute("ttm:role") === "x-bg" ||
    span.getAttributeNS("http://www.w3.org/ns/ttml#metadata", "role") === "x-bg"
  );
}

/**
 * A syllable is part of the preceding word when no whitespace separates them.
 * Apple's TTML encodes the space inside the span text, so trailing whitespace
 * on span N means span N+1 starts a new word.
 */
function collectSyllables(container: Element): Syllable[] {
  const spans = Array.from(container.children).filter(
    (child) => child.tagName.toLowerCase() === "span" && !isBackground(child),
  );
  return spans.map((span) => {
    const raw = span.textContent ?? "";
    return {
      Text: raw.trim(),
      StartTime: parseTTMLTime(span.getAttribute("begin")),
      EndTime: parseTTMLTime(span.getAttribute("end")),
      IsPartOfWord: raw.length > 0 && !/\s$/.test(raw),
    };
  }).filter((syllable) => syllable.Text.length > 0);
}

export function parseLocalTTML(ttml: string): SpicyLyrics | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(ttml, "application/xml");
  } catch {
    return null;
  }
  if (doc.querySelector("parsererror")) return null;

  const paragraphs = Array.from(doc.getElementsByTagName("p"));
  if (paragraphs.length === 0) return null;

  const hasTimedSpans = paragraphs.some((p) =>
    Array.from(p.getElementsByTagName("span")).some((s) => s.hasAttribute("begin")),
  );

  if (hasTimedSpans) {
    const content: SyllableLyrics["Content"] = [];
    for (const p of paragraphs) {
      const lead = collectSyllables(p);
      if (lead.length === 0) continue;

      const backgroundGroups = Array.from(p.children)
        .filter((child) => child.tagName.toLowerCase() === "span" && isBackground(child))
        .map((group) => ({
          StartTime: parseTTMLTime(group.getAttribute("begin")),
          EndTime: parseTTMLTime(group.getAttribute("end")),
          Syllables: collectSyllables(group),
        }))
        .filter((group) => group.Syllables.length > 0);

      const entry: SyllableLyrics["Content"][number] = {
        Lead: {
          StartTime: parseTTMLTime(p.getAttribute("begin")) || lead[0].StartTime,
          EndTime: parseTTMLTime(p.getAttribute("end")) || lead[lead.length - 1].EndTime,
          Syllables: lead,
        },
      };
      if (backgroundGroups.length > 0) entry.Background = backgroundGroups;
      content.push(entry);
    }
    if (content.length === 0) return null;
    return { Type: "Syllable", StartTime: content[0].Lead.StartTime, Content: content };
  }

  const hasTimedLines = paragraphs.some((p) => p.hasAttribute("begin"));

  if (hasTimedLines) {
    const content = paragraphs
      .map((p) => ({
        Text: (p.textContent ?? "").trim(),
        StartTime: parseTTMLTime(p.getAttribute("begin")),
        EndTime: parseTTMLTime(p.getAttribute("end")),
      }))
      .filter((line) => line.Text.length > 0);
    if (content.length === 0) return null;
    return { Type: "Line", StartTime: content[0].StartTime, Content: content };
  }

  const lines = paragraphs
    .map((p) => ({ Text: (p.textContent ?? "").trim() }))
    .filter((line) => line.Text.length > 0);
  if (lines.length === 0) return null;
  return { Type: "Static", Lines: lines };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/lyrics/toSpicyShape.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lyrics/toSpicyShape.ts tests/lyrics/toSpicyShape.test.ts
git commit -m "feat(lyrics): local TTML to Spicy shape converter"
```

---

### Task 6: Electron lyrics fetch path

**Files:**
- Create: `src/renderer/lyrics/fetchLyricsElectron.ts`
- Test: `tests/lyrics/fetchLyricsElectron.test.ts`

**Interfaces:**
- Consumes: `parseLocalTTML`, `SpicyLyrics` (Task 5); `getMusicState`, `setArtworkUrl` (Tasks 2, 3).
- Produces: `fetchLyricsForCurrentTrack(): Promise<[SpicyLyrics | string, number]>` — the tuple `ApplyLyrics` expects, where a string first element is one of upstream's descriptors (`"lyrics-not-found"`, `"unknown-track"`, `"unknown-error"`, `"offline"`). Also `normaliseLyricsResponse(response: unknown): [SpicyLyrics | string, number]` — the pure, tested part.

**The actual response shape**, confirmed from `src/main/index.js:281-296` and `src/main/lyrics/fetcher.js`. The main process already parses TTML and returns Spicy-shaped JSON — the renderer does *not* receive raw TTML on this path:

```js
null                                             // rejected, or nothing found at all
{ data: null,           provider, artworkUrl }   // artwork only, no lyrics
{ data: { Type, Content }, provider, artworkUrl } // Type is "Syllable" or "Line"
```

`provider` is one of `"spicylyrics" | "apple" | "lrclib" | "genius"`. `artworkUrl` may be null.

Note that sources emit `{ Content, Type }` with **no `StartTime`**, which `Syllable.ts` reads at `data.StartTime >= getLyricsBetweenShow()` to decide whether to render the leading musical-dots line. Derive it rather than leaving it undefined.

`parseLocalTTML` from Task 5 is therefore not used on this path — it exists for Phase 2's custom-TTML authoring, where the renderer *does* handle raw TTML. Import it here anyway for the `ttml` fallback branch, which covers a main process that hands back an unparsed document.

- [ ] **Step 1: Write the failing test**

Create `tests/lyrics/fetchLyricsElectron.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { normaliseLyricsResponse } from "../../src/renderer/lyrics/fetchLyricsElectron.ts";

const SYLLABLE = {
  Type: "Syllable",
  Content: [{ Lead: { StartTime: 12_500, EndTime: 15_000, Syllables: [] } }],
};

describe("normaliseLyricsResponse", () => {
  test("passes through already-shaped Syllable JSON", () => {
    const [content, status] = normaliseLyricsResponse({
      data: SYLLABLE, provider: "spicylyrics", artworkUrl: null,
    });
    expect(status).toBe(200);
    expect((content as any).Type).toBe("Syllable");
  });

  test("derives StartTime from the first line when the source omits it", () => {
    const [content] = normaliseLyricsResponse({
      data: SYLLABLE, provider: "spicylyrics", artworkUrl: null,
    });
    expect((content as any).StartTime).toBe(12_500);
  });

  test("derives StartTime for Line-type lyrics", () => {
    const [content] = normaliseLyricsResponse({
      data: { Type: "Line", Content: [{ Text: "a", StartTime: 9_000, EndTime: 11_000 }] },
      provider: "lrclib", artworkUrl: null,
    });
    expect((content as any).StartTime).toBe(9_000);
  });

  test("preserves an explicit StartTime", () => {
    const [content] = normaliseLyricsResponse({
      data: { ...SYLLABLE, StartTime: 42 }, provider: "spicylyrics", artworkUrl: null,
    });
    expect((content as any).StartTime).toBe(42);
  });

  test("reports not-found for a null response", () => {
    expect(normaliseLyricsResponse(null)).toEqual(["lyrics-not-found", 404]);
  });

  test("reports not-found when only artwork came back", () => {
    expect(
      normaliseLyricsResponse({ data: null, provider: "apple", artworkUrl: "https://x/a.jpg" }),
    ).toEqual(["lyrics-not-found", 404]);
  });

  test("reports unknown-error for a data object with no Type", () => {
    expect(
      normaliseLyricsResponse({ data: { Content: [] }, provider: "apple", artworkUrl: null }),
    ).toEqual(["unknown-error", 500]);
  });

  test("parses raw TTML if the main process ever returns it unparsed", () => {
    const ttml = `<tt><body><div><p begin="00:10.000" end="00:12.000">Hello</p></div></body></tt>`;
    const [content, status] = normaliseLyricsResponse({ data: ttml, provider: "apple", artworkUrl: null });
    expect(status).toBe(200);
    expect((content as any).Type).toBe("Line");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/lyrics/fetchLyricsElectron.test.ts`
Expected: FAIL — cannot resolve `fetchLyricsElectron.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/lyrics/fetchLyricsElectron.ts`:

```ts
/**
 * Replaces upstream's utils/Lyrics/fetchLyrics.ts.
 *
 * The main process owns provider selection, track matching and caching; this
 * only normalises what comes back into the tuple ApplyLyrics expects.
 */
import { getMusicState } from "../adapter/musicState.ts";
import { setArtworkUrl } from "../adapter/AppleMusicPlayer.ts";
import { parseLocalTTML, type SpicyLyrics } from "./toSpicyShape.ts";

export type LyricsResult = [SpicyLyrics | string, number];

/**
 * Sources emit { Content, Type } without StartTime, but Syllable.ts reads it to
 * decide whether to render the leading musical-dots line. Derive it from the
 * first entry rather than leaving the comparison against undefined.
 */
function withStartTime(data: Record<string, any>): SpicyLyrics {
  if (typeof data.StartTime === "number") return data as SpicyLyrics;
  const first = data.Content?.[0];
  const derived = first?.Lead?.StartTime ?? first?.StartTime ?? 0;
  return { ...data, StartTime: derived } as SpicyLyrics;
}

/** Pure. Everything testable about the fetch path lives here. */
export function normaliseLyricsResponse(response: unknown): LyricsResult {
  if (!response || typeof response !== "object") return ["lyrics-not-found", 404];

  const payload = response as Record<string, any>;
  const data = payload.data;

  if (data === null || data === undefined) return ["lyrics-not-found", 404];

  // Defensive: the main process parses TTML today, but handle a raw document
  // so a future source change degrades instead of rendering nothing.
  if (typeof data === "string") {
    const parsed = parseLocalTTML(data);
    if (!parsed) return ["unknown-error", 500];
    return [parsed, 200];
  }

  if (typeof data === "object" && typeof data.Type === "string") {
    return [withStartTime(data), 200];
  }

  return ["unknown-error", 500];
}

export async function fetchLyricsForCurrentTrack(): Promise<LyricsResult> {
  const track = getMusicState().track;
  if (!track) return ["unknown-track", 404];

  const api = (globalThis as any).electronAPI;
  if (!api?.fetchLyrics) return ["unknown-error", 500];

  try {
    const response = await api.fetchLyrics({
      name: track.nameCleaned,
      artist: track.artistCleaned,
      album: track.album,
    });
    // Artwork rides along on this response; AppleScript gives us no image.
    setArtworkUrl((response as any)?.artworkUrl ?? null);
    return normaliseLyricsResponse(response);
  } catch {
    return ["unknown-error", 500];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/lyrics/fetchLyricsElectron.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lyrics/fetchLyricsElectron.ts tests/lyrics/fetchLyricsElectron.test.ts
git commit -m "feat(lyrics): Electron fetch path normalising into Spicy's shape"
```

---

### Task 7: Renderer entry

**Files:**
- Create: `src/renderer/main.ts`
- Modify: `src/renderer/index.html`
- Read for reference (do not edit): `src/app.tsx:1-115` (CSS imports and init order), `src/app.tsx:1026-1073` (teardown and fullscreen wiring)

**Interfaces:**
- Consumes: `installSpicetifyShim` (Task 4), `subscribeMusicState` (Task 2), `fetchLyricsForCurrentTrack` (Task 6).
- Produces: a working overlay rendering Spicy's page. This is the task where the app visibly changes.

**Order matters:** `installSpicetifyShim()` must be called before any `import` of upstream code executes. Static ESM imports are hoisted, so the shim goes in its own module imported first, and upstream modules are pulled in with dynamic `import()` afterwards.

- [ ] **Step 1: Reduce index.html to a mount point**

Replace `src/renderer/index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sweetly</title>
    <link rel="stylesheet" href="https://fonts.spikerko.org/spicy-lyrics/source.css" />
    <link rel="stylesheet" href="https://fonts.spikerko.org/Vazirmatn/source.css" />
    <style>
      /* Chromium paints an opaque fill behind the vibrancy layer unless every
         ancestor is explicitly transparent. */
      html, body, #root, #app {
        background: transparent !important;
        margin: 0;
        padding: 0;
        height: 100%;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the entry**

Create `src/renderer/main.ts`:

```ts
/**
 * Sweetly renderer entry. Models src/app.tsx, minus everything that exists to
 * embed into Spotify's chrome (NPVLyrics, PopupLyrics, the now-playing-bar
 * observers, update dialog and migration).
 *
 * The shim is installed before any upstream module loads — hence the dynamic
 * imports below. Static imports are hoisted and would run upstream module-scope
 * code against a missing Spicetify global.
 */
import { installSpicetifyShim } from "./adapter/spicetifyShim.ts";
import { subscribeMusicState, onMusicStateChange, getMusicState } from "./adapter/musicState.ts";

installSpicetifyShim();

async function start(): Promise<void> {
  // Upstream stylesheets, in app.tsx's order. Order is load-bearing: tokens and
  // primitives define the custom properties the later sheets consume.
  await import("../css/tokens.css");
  await import("../css/primitives.css");
  await import("../css/default.css");
  await import("../css/default.scss");
  await import("../css/Simplebar.css");
  await import("../css/ContentBox.css");
  await import("../css/DynamicBG/spicy-dynamic-bg.css");
  await import("../css/Lyrics/main.css");
  await import("../css/Lyrics/Mixed.css");
  await import("../css/Loaders/LoaderContainer.css");
  await import("../css/font-pack/font-pack.css");
  await import("../css/settings-panel.css");
  await import("../components/ReactComponents/LyricsManager/styles.css");

  const [
    { default: PageView },
    { default: ApplyDynamicBackground },
    { default: LoadFonts, ApplyFontPixel },
    { UpdateNowBar },
    { default: ApplyLyrics },
    { requestPositionSync },
  ] = await Promise.all([
    import("../components/Pages/PageView.ts"),
    import("../components/DynamicBG/dynamicBackground.ts"),
    import("../components/Styling/Fonts.ts"),
    import("../components/Utils/NowBar.ts"),
    import("../utils/Lyrics/Global/Applyer.ts"),
    import("../utils/Gets/GetProgress.ts"),
  ]);

  const { fetchLyricsForCurrentTrack } = await import("./lyrics/fetchLyricsElectron.ts");

  LoadFonts();
  ApplyFontPixel();

  subscribeMusicState();

  await PageView.Open();

  let lastTrackId: string | null = null;

  onMusicStateChange(async (state) => {
    UpdateNowBar();
    requestPositionSync();

    const id = state.track ? `${state.track.artistCleaned}--${state.track.nameCleaned}` : null;
    if (id === lastTrackId) return;
    lastTrackId = id;

    if (!id) return;

    void ApplyDynamicBackground(document.querySelector(".spicy-dynamic-bg"));

    const result = await fetchLyricsForCurrentTrack();
    await ApplyLyrics(result as any);
  });

  // The first music-update may already have landed before we subscribed.
  if (getMusicState().track) {
    const result = await fetchLyricsForCurrentTrack();
    await ApplyLyrics(result as any);
  }
}

void start();
```

- [ ] **Step 3: Run the app**

Run: `bun run dev`
Expected: the window opens showing Spicy's page layout — NowBar with artwork, title, artists, and the lyrics container. Play a track in Music.app and lyrics should apply.

- [ ] **Step 4: Check the console for shim gaps**

In the DevTools console, look for `Spicetify is not defined`, `Cannot read properties of undefined`, or an unresolved import. Each one names a Spicetify API the shim is missing — add it to `spicetifyShim.ts` with the narrowest stub that satisfies the call site, and add a test to `tests/adapter/spicetifyShim.test.ts` covering it.

- [ ] **Step 5: Verify no runaway timers**

In DevTools, Performance tab, record 10 seconds while paused. Expected: no repeating 300ms task hunting for `.main-nowPlayingBar-right`, and no continuous `requestAnimationFrame` loop from `Platform.ts`. If either appears, the Task 3 `Playbar` stub or the Task 4 `platformShim` alias is not taking effect — check the Vite alias regexes resolve.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/main.ts src/renderer/index.html
git commit -m "feat(renderer): mount Spicy's page view as the Sweetly entry point"
```

---

### Task 8: Electron behaviour for the view controls

**Files:**
- Create: `src/renderer/adapter/viewControls.ts`
- Modify: `src/renderer/main.ts` (call the installer after `PageView.Open()`)
- Modify: `src/main/index.js` (add a `hide-window` IPC handler)
- Modify: `src/preload/index.js` (expose `hideWindow`)

**Interfaces:**
- Consumes: `PageView` from Task 7.
- Produces: `installViewControlBehaviour(): void`.

`PageView.ts:479` renders `<button id="Close">` and `:466` renders `<button id="FullscreenToggle">`. Upstream's handlers close a Spotify page and use the DOM Fullscreen API; both need Electron behaviour.

- [ ] **Step 1: Add the IPC handler in main**

In `src/main/index.js`, alongside the existing `toggle-fullscreen` handler, add:

```js
ipcMain.handle("hide-window", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  return true;
});
```

- [ ] **Step 2: Expose it in preload**

In `src/preload/index.js`, inside the `exposeInMainWorld` object, add:

```js
hideWindow: () => ipcRenderer.invoke("hide-window"),
```

- [ ] **Step 3: Write the installer**

Create `src/renderer/adapter/viewControls.ts`:

```ts
/**
 * Rebinds the two PageView controls whose upstream behaviour assumes Spotify.
 * Everything else in the ViewControls bar works unchanged.
 */
export function installViewControlBehaviour(): void {
  const api = (globalThis as any).electronAPI ?? {};

  const close = document.querySelector<HTMLButtonElement>("#Close");
  if (close) {
    close.onclick = (event) => {
      event.stopImmediatePropagation();
      api.hideWindow?.();
    };
  }

  const fullscreen = document.querySelector<HTMLButtonElement>("#FullscreenToggle");
  if (fullscreen) {
    fullscreen.onclick = (event) => {
      event.stopImmediatePropagation();
      api.toggleFullscreen?.();
    };
  }
}
```

- [ ] **Step 4: Call it from the entry**

In `src/renderer/main.ts`, immediately after `await PageView.Open();` add:

```ts
  const { installViewControlBehaviour } = await import("./adapter/viewControls.ts");
  installViewControlBehaviour();
```

- [ ] **Step 5: Verify by hand**

Run `bun run dev`. Click `Close` — the window hides. Reopen it from the dock. Click the fullscreen control — the window enters Electron fullscreen and the layout switches to Spicy's fullscreen arrangement (artwork left with scrubber, lyrics right).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/adapter/viewControls.ts src/renderer/main.ts src/main/index.js src/preload/index.js
git commit -m "feat(renderer): Electron behaviour for Close and Fullscreen controls"
```

---

### Task 9: Aligner settings section and capture toast

**Files:**
- Create: `src/renderer/components/AlignerSection.tsx`
- Modify: `src/renderer/main.ts`
- Read for reference (do not edit): `src/components/ReactComponents/SettingsPanel/PlaybackSection.tsx` (the component idiom to copy), `src/components/ReactComponents/SettingsPanel/components.tsx`

**Interfaces:**
- Consumes: `electronAPI.onAlignStatus` (existing preload surface).
- Produces: `AlignerSection` React component; `installAlignToasts(): () => void`.

Do not build a bespoke offset control. Upstream's `$playbackOffset` (`src/utils/stores.ts:80`) already drives `GetProgress.ts:174` and is already exposed by `PlaybackSection.tsx`.

- [ ] **Step 1: Write the aligner section**

Create `src/renderer/components/AlignerSection.tsx`:

```tsx
/**
 * Sweetly's only addition to the stock settings panel.
 *
 * Follows the exact contract of upstream's sections (see PlaybackSection.tsx):
 * props are { query, sectionFilter }, visibility is decided by matches(), and
 * the layout is SectionTitle + Row. Doing anything else here would make this
 * the one section that looks out of place.
 */
import React, { useEffect, useState } from "react";
import { matches, Row, SectionTitle, Toggle } from "../../components/ReactComponents/SettingsPanel/components.tsx";

const SECTION_NAME = "Alignment";

interface Props {
  query: string;
  sectionFilter: string;
}

export default function AlignerSection({ query, sectionFilter }: Props) {
  const [status, setStatus] = useState<string>("idle");
  const [autoAlign, setAutoAlign] = useState<boolean>(
    () => globalThis.localStorage?.getItem("sweetly:autoAlign") === "true",
  );

  useEffect(() => {
    const api = (globalThis as any).electronAPI;
    if (!api?.onAlignStatus) return;
    return api.onAlignStatus((payload: { state?: string }) => {
      setStatus(payload?.state ?? "idle");
    });
  }, []);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const r1 = matches(
    query,
    "Align Automatically",
    "Generate word-level timings when a track has no synced lyrics.",
  );
  const r2 = matches(query, "Aligner Status", "Current state of the alignment pipeline.");

  if (!r1 && !r2) return null;

  return (
    <>
      <SectionTitle>{SECTION_NAME}</SectionTitle>

      {r1 && (
        <Row
          label="Align Automatically"
          description="Generate word-level timings by listening to the track when no synced lyrics exist."
        >
          <Toggle
            value={autoAlign}
            onChange={(v: boolean) => {
              setAutoAlign(v);
              globalThis.localStorage?.setItem("sweetly:autoAlign", String(v));
            }}
          />
        </Row>
      )}

      {r2 && <Row label="Aligner Status" description={`Currently ${status}.`} />}
    </>
  );
}
```

Verify `Toggle`'s prop names against `components.tsx:39` before running — `Row` takes `label`, not `title`, and supports a `stacked` boolean.

**Do not add a playback-offset control.** `PlaybackSection.tsx` already renders a ±5000ms slider bound to `$playbackOffset`, which is exactly the Bluetooth-latency compensation the old `App.jsx` implemented by hand.

- [ ] **Step 2: Wire the capture toast**

In `src/renderer/main.ts`, inside `start()` after the view controls are installed:

```ts
  const { toast } = await import("sonner");
  const api = (globalThis as any).electronAPI;
  let activeToast: string | number | undefined;
  api?.onAlignStatus?.((payload: { state?: string; secondsLeft?: number }) => {
    if (payload?.state === "capturing") {
      const message = `Listening to sync lyrics — ${payload.secondsLeft ?? 0}s left`;
      activeToast = activeToast
        ? (toast.loading(message, { id: activeToast }), activeToast)
        : toast.loading(message);
    } else if (activeToast !== undefined) {
      toast.dismiss(activeToast);
      activeToast = undefined;
    }
  });
```

- [ ] **Step 3: Verify by hand**

Run `bun run dev`, open Settings from the ViewControls bar. The Lyrics Alignment section renders in the same idiom as the stock sections. Play a track with no synced lyrics and confirm a toast appears while capturing and dismisses afterwards.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/AlignerSection.tsx src/renderer/main.ts
git commit -m "feat(renderer): aligner settings section and transient capture toast"
```

---

### Task 10: Retire the old renderer

**Files:**
- Delete: `src/renderer/App.jsx`, `src/renderer/animationEngine.js`, `src/renderer/index.jsx`, `src/utils/ttmlParser.js`, `src/Lyrics/`

**Interfaces:**
- Consumes: a working Task 9 build.
- Produces: nothing new. This is the point of no return — do not start it until the app runs correctly on the new entry.

- [ ] **Step 1: Confirm nothing still imports them**

Run:

```bash
grep -rn "App.jsx\|animationEngine\|ttmlParser" src/ electron.vite.config.ts package.json --exclude-dir=node_modules
```

Expected: no matches outside the files being deleted. If `src/main/` imports `ttmlParser.js`, stop — the main process needs its own copy or the import rewritten to `renderer/lyrics/toSpicyShape.ts` first.

- [ ] **Step 2: Delete**

```bash
git rm src/renderer/App.jsx src/renderer/animationEngine.js src/renderer/index.jsx src/utils/ttmlParser.js
rmdir src/Lyrics 2>/dev/null || true
```

- [ ] **Step 3: Verify the build and tests**

Run: `bun run build && bun test`
Expected: build exits 0; all tests pass.

- [ ] **Step 4: Verify the app still runs**

Run: `bun run dev`. Play a track. Lyrics render, animate, and scroll.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(renderer): remove the hand-rolled lyrics UI superseded by Spicy's"
```

---

### Task 11: Parity verification

**Files:**
- Create: `docs/superpowers/plans/2026-07-27-parity-findings.md`

**Interfaces:**
- Consumes: everything.
- Produces: a findings document listing any visual divergence, each with a cause.

- [ ] **Step 1: Capture the comparison set**

With Sweetly and real Spicy Lyrics both playing the same track at the same position, screenshot both in each of: windowed, compact mode, fullscreen. Nine images minimum.

- [ ] **Step 2: Compare against the checklist**

For each pair, check and record pass/fail:

- line blur ramp as distance from the active line increases
- active-line scale and the word glow sweep, mid-word
- scroll physics at a line change — settle time and overshoot
- background gradient hue and motion speed
- ViewControls bar geometry: icon size, spacing, corner placement
- NowBar: artwork corner radius, title/artist type scale, scrubber height
- interlude dot group animation
- background-vocal line placement and opacity

- [ ] **Step 3: Verify the sync lag is gone**

Play a track with Apple Music's own lyrics panel open beside Sweetly. The active line must change at the same moment in both. If Sweetly still trails, adjust Settings → Playback → offset and record the value that corrects it; a non-zero requirement here is a Bluetooth latency artifact, not a bug.

- [ ] **Step 4: Write up findings**

Record each divergence with its suspected cause. Expected candidates, from the spec's risk list: colour extraction differing from Spotify's GraphQL palette, and tooltip styling from `TIPPY_PROPS`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-27-parity-findings.md
git commit -m "docs: Phase 1 parity verification findings"
```

---

## Self-Review

**Spec coverage.** Architecture → Tasks 7, 10. Adapter → Tasks 2, 3. Shim → Task 4. Lyrics data path → Tasks 5, 6. Custom TTML store → deferred to Phase 2 as the spec states, except that Task 5 builds the converter Phase 2 needs. Sweetly affordances → Task 9 (offset deleted by omission — no bespoke control is built, and the old `App.jsx` carrying it is deleted in Task 10). Build changes → Task 1. Cleanup → Task 10. Verification → Task 11. Licensing → already committed in `68d425d`, before this plan.

**Import-time DOM polling risk** → Task 3 Step 3 (`InertPlaybar`), Task 4 Step 4 (`platformShim`), verified in Task 7 Step 5.

**Type consistency.** `MusicState` defined Task 2, consumed Tasks 3, 6. `SpicyLyrics` defined Task 5, consumed Task 6. `installSpicetifyShim` defined Task 4, called Task 7. `parseLocalTTML` defined Task 5, called Task 6. `fetchLyricsForCurrentTrack` defined Task 6, called Task 7. `installViewControlBehaviour` defined Task 8, called Task 8 Step 4. The adapter's export is named `SpotifyPlayer`, not `AppleMusicPlayer`, in every reference — required by the alias.

**Corrections applied during review.** Two assumptions were checked against the source and found wrong:

1. The `fetch-lyrics` response is `{ data, provider, artworkUrl }`, and `data` is already Spicy-shaped JSON (`{ Content, Type }`) — the main process parses TTML itself via `main/lyrics/ttmlXml.js`. Task 6 was rewritten against the real shape; `parseLocalTTML` remains for Phase 2 and as a defensive fallback.
2. Artwork is not on the `music-update` payload — AppleScript returns no image. It arrives as `artworkUrl` on the fetch response, so Task 3 gained `setArtworkUrl`/`getArtworkUrl` and Task 6 populates it.

3. `SettingsPanel/components.tsx` exports no `Section` — the idiom is `SectionTitle` + `Row`, with sections taking `{ query, sectionFilter }` and gating visibility through `matches()`. Task 9 was rewritten to that contract, and confirmed `PlaybackSection.tsx` already renders a ±5000ms `$playbackOffset` slider, so no offset control is built.

**No remaining placeholders.** Every step contains the code or command it calls for. The one instruction to check something at implementation time — `Toggle`'s prop names at `components.tsx:39` — is a two-line read, not deferred design.
