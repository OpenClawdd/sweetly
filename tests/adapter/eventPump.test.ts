import { describe, expect, it, vi } from "vitest";
import { createEventPump } from "../../src/renderer/adapter/eventPump.ts";

/**
 * app.tsx drove upstream's UI with interval loops that evoked playback events
 * (app.tsx:887-934, 969-977). renderer/main.ts replaced app.tsx and reproduced
 * none of them, so every listener downstream was dead code:
 *
 *   playback:position   -> NowBar.ts:1347, the only thing that advances the
 *                          progress bar. Left unfired it reads 0:00 forever.
 *   playback:songchange -> dynamicBackground.ts:366,447, which crossfades the
 *                          artwork. Left unfired, track switches snap.
 *   playback:playpause  -> NowBar.ts:1275, play/pause button state.
 */

function setup(initial: { position: number; playing: boolean; uri?: string }) {
  const evoke = vi.fn();
  const state = { ...initial };
  const pump = createEventPump({
    evoke,
    getPosition: () => state.position,
    isPlaying: () => state.playing,
    getUri: () => state.uri,
  });
  return { evoke, state, pump };
}

const names = (evoke: ReturnType<typeof vi.fn>) => evoke.mock.calls.map((c) => c[0]);

describe("createEventPump", () => {
  it("evokes playback:position when the position advances", () => {
    const { evoke, state, pump } = setup({ position: 0, playing: true, uri: "apple:track:a" });

    pump.tick();
    state.position = 1500;
    pump.tick();

    expect(evoke).toHaveBeenCalledWith("playback:position", 1500);
  });

  it("does not re-evoke position when it has not changed", () => {
    const { evoke, pump } = setup({ position: 4200, playing: true, uri: "apple:track:a" });

    pump.tick();
    pump.tick();
    pump.tick();

    expect(names(evoke).filter((n) => n === "playback:position")).toHaveLength(1);
  });

  it("evokes playback:songchange when the track changes", () => {
    const { evoke, state, pump } = setup({ position: 90_000, playing: true, uri: "apple:track:a" });

    pump.tick();
    state.uri = "apple:track:b";
    state.position = 0;
    pump.tick();

    expect(evoke).toHaveBeenCalledWith(
      "playback:songchange",
      expect.objectContaining({ data: expect.objectContaining({ item: { uri: "apple:track:b" } }) })
    );
  });

  it("emits songchange before position so listeners reset first", () => {
    const { evoke, state, pump } = setup({ position: 90_000, playing: true, uri: "apple:track:a" });

    pump.tick();
    evoke.mockClear();
    state.uri = "apple:track:b";
    state.position = 250;
    pump.tick();

    const order = names(evoke);
    expect(order.indexOf("playback:songchange")).toBeLessThan(order.indexOf("playback:position"));
  });

  it("does not announce a songchange for the very first track", () => {
    const { evoke, pump } = setup({ position: 0, playing: true, uri: "apple:track:a" });

    pump.tick();

    expect(names(evoke)).not.toContain("playback:songchange");
  });

  it("evokes playback:playpause with the isPaused shape NowBar expects", () => {
    const { evoke, state, pump } = setup({ position: 1000, playing: true, uri: "apple:track:a" });

    pump.tick();
    state.playing = false;
    pump.tick();

    expect(evoke).toHaveBeenCalledWith("playback:playpause", { data: { isPaused: true } });
  });

  it("survives a missing track without emitting a bogus songchange", () => {
    const { evoke, pump } = setup({ position: 0, playing: false, uri: undefined });

    pump.tick();
    pump.tick();

    expect(names(evoke)).not.toContain("playback:songchange");
  });
});
