/**
 * Republishes player state as the Global.Event signals upstream listens for.
 *
 * Inside Spotify, app.tsx did this: interval loops polled the player and
 * evoked `playback:position`, `playback:songchange`, `playback:playpause` and
 * friends (app.tsx:887-934, 969-977). renderer/main.ts replaced app.tsx but
 * reproduced none of it, which left several upstream features as dead code —
 * they were listening for events nothing sent:
 *
 *   playback:position   NowBar.ts:1347 — the only code that advances the
 *                       progress bar, so it displayed 0:00 permanently.
 *   playback:songchange dynamicBackground.ts:366,447 — the artwork crossfade,
 *                       so track switches snapped instead of blending. Also
 *                       LyricsQueueRetry.ts:152, which discards a stale
 *                       in-flight retry when the track changes.
 *   playback:playpause  NowBar.ts:1275 — play/pause button state.
 *
 * This is deliberately a pure state machine over injected getters: no timers,
 * no imports, no globals. The caller owns the tick (main.ts drives it from an
 * IntervalManager, matching app.tsx's 0.5s cadence), and tests drive it by
 * hand.
 */

export interface EventPumpDeps {
  /** Global.Event.evoke */
  evoke: (name: string, payload?: unknown) => void;
  /** Playback position in milliseconds. */
  getPosition: () => number;
  isPlaying: () => boolean;
  /** Stable per-track identifier; undefined when nothing is loaded. */
  getUri: () => string | undefined;
}

export interface EventPump {
  tick: () => void;
}

export function createEventPump({ evoke, getPosition, isPlaying, getUri }: EventPumpDeps): EventPump {
  // `null` means "nothing observed yet", which is distinct from a real value
  // and is what suppresses spurious events on the very first tick.
  let lastUri: string | undefined | null = null;
  let lastPlaying: boolean | null = null;
  let lastPosition: number | null = null;

  return {
    tick() {
      const uri = getUri();
      if (uri !== lastUri) {
        // Only a genuine change counts. The first observation establishes the
        // baseline, and an absent track must not masquerade as a switch.
        if (lastUri !== null && uri) {
          evoke("playback:songchange", { data: { item: { uri } } });
        }
        lastUri = uri;
        // The new track's position is unrelated to the old one's, so force the
        // next comparison to emit rather than suppress a coincidental match.
        lastPosition = null;
      }

      const playing = isPlaying();
      if (playing !== lastPlaying) {
        if (lastPlaying !== null) {
          // NowBar.ts:1275 and dynamicBackground.ts:461 both read `isPaused`.
          evoke("playback:playpause", { data: { isPaused: !playing } });
        }
        lastPlaying = playing;
      }

      const position = getPosition();
      if (position !== lastPosition) {
        evoke("playback:position", position);
        lastPosition = position;
      }
    },
  };
}
