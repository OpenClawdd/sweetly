/**
 * Apple Music implementation of upstream's SpotifyPlayer surface.
 *
 * The Vite config aliases `components/Global/SpotifyPlayer.ts` to this file, so
 * every upstream consumer keeps its original import and upstream stays
 * byte-identical. The export is therefore still named `SpotifyPlayer`.
 *
 * Units: Apple Music reports SECONDS; Spicy expects MILLISECONDS everywhere.
 * Conversion happens here and nowhere else.
 */
import { getMusicState } from "./musicState.ts";

export type CoverSizes = "standard" | "small" | "large" | "xlarge";
export type Artist = { type: "artist"; name: string; uri: string };

const PLACEHOLDER = "https://images.spikerko.org/SongPlaceholderFull.png";

const api = (): any => (globalThis as unknown as { electronAPI?: any }).electronAPI ?? {};

/**
 * Artwork arrives on the fetch-lyrics response as `artworkUrl` — AppleScript
 * gives us no image, so there is nothing to read off the music-update payload.
 */
let artworkUrl: string | null = null;

export function setArtworkUrl(url: string | null): void {
  artworkUrl = url;
}

export function getArtworkUrl(): string | null {
  return artworkUrl;
}

/**
 * Upstream's GetProgress.ts imports SpotifyPlayer at module scope, and this
 * module is what that import now resolves to. Importing it back statically
 * would be an ESM cycle whose bindings are still in the temporal dead zone when
 * the first module body runs — a ReferenceError at startup, not a subtle bug.
 *
 * So the smoothed clock is injected instead: main.ts imports GetProgress once
 * both modules exist and hands it over. Until then GetPosition falls back to
 * the raw player position, which is correct, just unsmoothed.
 */
type ProgressProvider = () => number;
let progressProvider: ProgressProvider | null = null;

export function setProgressProvider(provider: ProgressProvider): void {
  progressProvider = provider;
}

/** Stable per-track identifier. Apple Music has no URI, so derive one. */
function trackId(): string | undefined {
  const track = getMusicState().track;
  if (!track) return undefined;
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug(track.artistCleaned)}--${slug(track.nameCleaned)}`;
}

function rawPositionMs(): number {
  const track = getMusicState().track;
  return track ? track.position * 1000 : 0;
}

/**
 * Upstream's Playbar mounts buttons into Spotify's now-playing bar, retrying on
 * a 300ms timer until that DOM appears. It never appears here, so these are
 * inert stubs: same constructor shape, no timers, no DOM queries. Without this
 * the app would burn a repeating timer for its entire lifetime.
 */
const InertPlaybar = (() => {
  class Button {
    public element: HTMLButtonElement;
    public iconElement: HTMLSpanElement;
    public tippy: unknown = null;
    private _label: string;
    private _icon: string;
    private _onClick: (button: Button) => void;
    private _disabled: boolean;
    private _active: boolean;

    constructor(
      label: string,
      icon: string,
      onClick: (button: Button) => void = () => {},
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

    get label(): string {
      return this._label;
    }
    set label(text: string) {
      this._label = text;
      this.element.setAttribute("title", text);
    }
    get icon(): string {
      return this._icon;
    }
    set icon(input: string) {
      this._icon = input;
      this.iconElement.innerHTML = input;
    }
    get onClick(): (button: Button) => void {
      return this._onClick;
    }
    set onClick(fn: (button: Button) => void) {
      this._onClick = fn;
      this.element.onclick = () => fn(this);
    }
    get disabled(): boolean {
      return this._disabled;
    }
    set disabled(value: boolean) {
      this._disabled = value;
      this.element.disabled = value;
    }
    get active(): boolean {
      return this._active;
    }
    set active(value: boolean) {
      this._active = value;
    }

    register(): void {}
    deregister(): void {
      this.element.remove();
    }
  }

  class Widget extends Button {}

  return { Button, Widget };
})();

export const SpotifyPlayer = {
  get IsPlaying(): boolean {
    return getMusicState().status === "playing";
  },
  _DEPRECATED_: {
    GetTrackPosition: (): number => rawPositionMs(),
  },
  GetPosition: (): number => (progressProvider ? progressProvider() : rawPositionMs()),
  GetContentType: (): string => "track",
  GetMediaType: (): string => "audio",
  GetDuration: (): number => {
    const track = getMusicState().track;
    return track ? Math.round(track.duration * 1000) : 0;
  },
  /** Raw, unsmoothed player position in ms. GetProgress builds on this. */
  GetRawPosition: rawPositionMs,
  Seek: (position: number): void => {
    api().seekTo?.(position / 1000);
  },
  GetCover: (_size?: CoverSizes): string | undefined => artworkUrl || PLACEHOLDER,
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
    return [
      { type: "artist", name: track.artist, uri: `apple:artist:${track.artistCleaned}` },
    ];
  },
  GetUri: (): string | undefined => {
    const id = trackId();
    return id ? `apple:track:${id}` : undefined;
  },
  Pause: (): void => api().togglePlayPause?.(),
  Play: (): void => api().togglePlayPause?.(),
  TogglePlayState: (): void => api().togglePlayPause?.(),
  Skip: {
    Next: (): void => api().nextTrack?.(),
    Prev: (): void => api().previousTrack?.(),
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
