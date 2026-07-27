/**
 * Latest Apple Music player state, fed by the `music-update` IPC channel.
 *
 * Deliberately knows nothing about Spicy — AppleMusicPlayer.ts adapts this into
 * the shape upstream expects. Keeping the two apart means the payload can change
 * shape without touching the adapter's surface, and vice versa.
 *
 * Units here are Apple Music's own: position and duration are SECONDS.
 * Conversion to the milliseconds Spicy wants happens in AppleMusicPlayer.ts.
 */

export type MusicTrack = {
  name: string;
  nameCleaned: string;
  artist: string;
  artistCleaned: string;
  album: string;
  /** SECONDS. */
  position: number;
  /** SECONDS. */
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
const listeners = new Set<(state: MusicState) => void>();

function publish(state: MusicState): void {
  current = state;
  for (const listener of listeners) {
    // One bad subscriber must not stop the rest — a throw here would leave the
    // UI half-updated, and the poller fires every 500ms so it would repeat.
    try {
      listener(state);
    } catch (error) {
      console.error("[Sweetly] music state subscriber failed:", error);
    }
  }
}

export function getMusicState(): MusicState {
  return current;
}

export function onMusicStateChange(cb: (state: MusicState) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Test seam. Production code goes through subscribeMusicState. */
export function setMusicStateForTest(state: MusicState): void {
  publish(state);
}

/** Wires the IPC channel. Returns an unsubscribe. */
export function subscribeMusicState(): () => void {
  const api = (globalThis as unknown as { electronAPI?: any }).electronAPI;
  if (!api?.onMusicUpdate) return () => {};
  return api.onMusicUpdate((state: MusicState) => publish(state)) ?? (() => {});
}
