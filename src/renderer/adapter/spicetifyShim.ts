/**
 * Minimal globalThis.Spicetify covering only what the retained UI touches:
 *
 *   Tippy / TippyProps            PageView.ts control tooltips
 *   Player.setShuffle / setRepeat  NowBar.ts
 *   GraphQL.Request                dynamicBackground.ts colour lookup
 *   LocalStorage                   settings persistence
 *
 * Everything else is a narrow stub that exists so a property access does not
 * throw. MUST run before any upstream module is imported — several read
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

const api = (): any => (globalThis as unknown as { electronAPI?: any }).electronAPI ?? {};

export function installSpicetifyShim(): void {
  if ((globalThis as any).Spicetify) return;

  (globalThis as any).Spicetify = {
    Tippy: (element: Element, props: Record<string, unknown> = {}) =>
      tippy(element as HTMLElement, { ...TIPPY_PROPS, ...props }),
    TippyProps: TIPPY_PROPS,

    Player: {
      setShuffle: (_enabled: boolean) => api().toggleShuffle?.(),
      // Upstream calls setRepeat(0|1|2). Music.app exposes only a cycle, so we
      // step it and let the 500ms poller report the mode it landed on.
      setRepeat: (_mode: number) => api().cycleRepeat?.(),
      addEventListener: () => {},
      removeEventListener: () => {},
      pause: () => api().togglePlayPause?.(),
      play: () => api().togglePlayPause?.(),
      togglePlay: () => api().togglePlayPause?.(),
      next: () => api().nextTrack?.(),
      back: () => api().previousTrack?.(),
      getHeart: () => false,
      // GetProgress calls this as a function (upstream's SpotifyPlayer.IsPlaying
      // is a property — they are not the same thing). Throwing here kills the
      // whole lyrics render, so it must exist.
      isPlaying: () => (globalThis as any).__sweetlyIsPlaying?.() ?? false,
      data: null,
    },

    GraphQL: {
      Definitions: { getDynamicColorsByUris: "getDynamicColorsByUris" },
      Request: async (_definition: unknown, variables: any) => {
        const colors = await extractColors(variables?.imageUrl ?? variables?.uri ?? "");
        return {
          data: {
            extractedColors: [{ colorRaw: { hex: colors.VIBRANT_NON_ALARMING }, ...colors }],
          },
        };
      },
    },

    LocalStorage: {
      get: (key: string): string | null => globalThis.localStorage?.getItem(key) ?? null,
      set: (key: string, value: string): void => globalThis.localStorage?.setItem(key, value),
      remove: (key: string): void => globalThis.localStorage?.removeItem(key),
    },

    Platform: {
      version: "1.2.0",
      History: { push: () => {}, goBack: () => {}, listen: () => () => {} },
      // GetProgress.ts reads PlaybackAPI._isLocal to decide whether the local
      // clock is authoritative or it must sync against a remote device. Apple
      // Music plays on this machine, so local is always correct — and saying so
      // skips the remote-sync path that has nothing to talk to.
      PlaybackAPI: { _isLocal: true },
      // requestPositionSync walks PlayerAPI._contextPlayer.getPositionState()
      // for a precise clock sample. Apple Music has no equivalent, so report the
      // position the poller already gave us and let GetProgress smooth it.
      PlayerAPI: {
        _contextPlayer: {
          getPositionState: async () => ({
            position: (globalThis as any).__sweetlyRawPositionMs?.() ?? 0,
          }),
          resume: async () => {},
        },
        _state: { positionAsOfTimestamp: 0, timestamp: Date.now() },
      },
    },
    Keyboard: { registerImportantShortcut: () => {}, ValidKeys: {} },
    CosmosAsync: { get: async () => ({}), post: async () => ({}) },
    ReactComponent: {},
    SVGIcons: {},
    colorExtractor: async () => ({ VIBRANT_NON_ALARMING: "#999999" }),
  };
}
