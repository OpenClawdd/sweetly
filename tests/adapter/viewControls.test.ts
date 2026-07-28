import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Upstream renders the view controls with `elem.innerHTML = ...`
 * (PageView.ts:431), which discards every listener attached to the old nodes.
 * AppendViewControls(true) runs from ~20 sites — every track change
 * (fetchLyrics.ts:46), every fullscreen toggle, every NowBar change — and
 * Fullscreen.Open schedules one on a 50ms timer (Fullscreen.ts:238) that fires
 * *after* our startup binding. Binding onclick per element therefore produced
 * buttons that never worked at all.
 *
 * Delegation from a stable ancestor is the fix: the listener outlives any
 * number of re-renders because it is not attached to the buttons.
 */

const openSettingsPanel = vi.fn();
const fullscreenOpen = vi.fn();
const toggleCompactMode = vi.fn();
const romanizationSet = vi.fn();
const openLyricsDBPanel = vi.fn();

vi.mock("../../src/utils/settings.ts", () => ({ openSettingsPanel: () => openSettingsPanel() }));
vi.mock("../../src/utils/uiState.ts", () => ({
  $romanization: { get: () => false, set: (v: boolean) => romanizationSet(v) },
}));
vi.mock("../../src/components/Utils/Fullscreen.ts", () => ({
  default: { Open: (v: boolean) => fullscreenOpen(v) },
}));
vi.mock("../../src/components/Utils/CompactMode.ts", () => ({
  ToggleCompactMode: () => toggleCompactMode(),
}));
vi.mock("../../src/renderer/adapter/musicState.ts", () => ({
  getMusicState: () => ({ track: { position: 10 } }),
}));
vi.mock("../../src/utils/openLyricsDBPanel.tsx", () => ({
  OpenLyricsDBPanel: () => openLyricsDBPanel(),
}));

const CONTROLS = `
  <button id="CinemaView" class="ViewControl"></button>
  <button id="FullscreenToggle" class="ViewControl"></button>
  <button id="LyricsManager" class="ViewControl"></button>
  <button id="SettingsToggle" class="ViewControl"></button>
  <button id="Close" class="ViewControl"></button>
`;

let api: Record<string, ReturnType<typeof vi.fn>>;

function render() {
  const host = document.querySelector<HTMLElement>("#SpicyLyricsPage .ViewControls")!;
  host.innerHTML = CONTROLS; // exactly what AppendViewControls does
}

function click(id: string) {
  document.querySelector<HTMLButtonElement>(`#${id}`)!.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = `<div id="SpicyLyricsPage"><div class="ViewControls"></div></div>`;
  render();
  api = {
    hideWindow: vi.fn(),
    toggleFullscreen: vi.fn(),
    togglePlayPause: vi.fn(),
    seekTo: vi.fn(),
  };
  (globalThis as any).electronAPI = api;
  (globalThis as any).window.__sweetlyShortcutsInstalled = false;
});

afterEach(() => {
  delete (globalThis as any).electronAPI;
});

describe("installViewControlBehaviour", () => {
  it("handles clicks on the initially rendered buttons", async () => {
    const { installViewControlBehaviour } = await import("../../src/renderer/adapter/viewControls.ts");
    installViewControlBehaviour();

    click("FullscreenToggle");
    expect(api.toggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it("still handles clicks after the controls are re-rendered", async () => {
    const { installViewControlBehaviour } = await import("../../src/renderer/adapter/viewControls.ts");
    installViewControlBehaviour();

    render(); // AppendViewControls(true) — replaces every button node
    click("FullscreenToggle");
    expect(api.toggleFullscreen).toHaveBeenCalledTimes(1);

    render();
    render();
    click("SettingsToggle");
    expect(openSettingsPanel).toHaveBeenCalledTimes(1);
  });

  it("binds only once even if installed repeatedly", async () => {
    const { installViewControlBehaviour } = await import("../../src/renderer/adapter/viewControls.ts");
    installViewControlBehaviour();
    installViewControlBehaviour();
    installViewControlBehaviour();

    click("Close");
    expect(api.hideWindow).toHaveBeenCalledTimes(1);
  });

  it("wires the LyricsManager button", async () => {
    const { installViewControlBehaviour } = await import("../../src/renderer/adapter/viewControls.ts");
    installViewControlBehaviour();

    click("LyricsManager");
    expect(openLyricsDBPanel).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks that land outside any known control", async () => {
    const { installViewControlBehaviour } = await import("../../src/renderer/adapter/viewControls.ts");
    installViewControlBehaviour();

    document.querySelector<HTMLElement>("#SpicyLyricsPage")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(api.toggleFullscreen).not.toHaveBeenCalled();
    expect(api.hideWindow).not.toHaveBeenCalled();
  });
});
