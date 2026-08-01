import { openSettingsPanel } from "../../utils/settings.ts";
import { $romanization } from "../../utils/uiState.ts";
import Fullscreen from "../../components/Utils/Fullscreen.ts";
import { ToggleCompactMode } from "../../components/Utils/CompactMode.ts";
import { OpenLyricsDBPanel } from "../../utils/openLyricsDBPanel.tsx";
import { getMusicState } from "./musicState.ts";

/**
 * Host-side behaviour for the view-control buttons.
 *
 * These MUST be delegated rather than bound per element. PageView.ts:431
 * renders the controls with `elem.innerHTML = ...`, which throws away every
 * node — and AppendViewControls(true) runs from roughly twenty places,
 * including every track change (fetchLyrics.ts:46) and every fullscreen
 * toggle. Worse, Fullscreen.Open schedules one on a 50ms timer
 * (Fullscreen.ts:238); our startup binding used to be wiped by that timer
 * moments after it was installed, so the buttons never worked even once.
 *
 * Upstream attaches its own listeners on each render, but two of them do not
 * do what this app needs:
 *
 *   - #FullscreenToggle only flips Spicy's internal cinema/fullscreen state.
 *     The Electron window itself is ours to toggle, so we handle it here.
 *   - #SettingsToggle is never wired at all when the page opens in fullscreen:
 *     PageView.ts nests `settingsButton.addEventListener` inside
 *     `if (cinemaViewBtn && !Fullscreen.IsOpen)`, and #CinemaView is only
 *     rendered while fullscreen is closed. main.ts opens fullscreen at
 *     startup, so that branch never runs.
 *
 * Delegation is registered on `document` exactly once, in the capture phase,
 * so it fires regardless of how often the buttons are replaced.
 */

let delegationInstalled = false;

function api(): Record<string, (...args: unknown[]) => void> {
  return (globalThis as unknown as { electronAPI?: Record<string, () => void> }).electronAPI ?? {};
}

/**
 * Actions keyed by button id. Upstream also binds some of these; where both
 * run the duplicate is harmless (they are idempotent toggles of distinct
 * state), and where upstream fails to bind at all this is the only handler.
 */
const ACTIONS: Record<string, () => void> = {
  Close: () => api().hideWindow?.(),
  FullscreenToggle: () => api().toggleFullscreen?.(),
  CinemaView: () => Fullscreen.Open(true),
  SettingsToggle: () => openSettingsPanel(),
  LyricsManager: () => OpenLyricsDBPanel(),
  RomanizationToggle: () => $romanization.set(!$romanization.get()),
  CompactModeToggle: () => ToggleCompactMode(),
};

export function installViewControlBehaviour(): void {
  installDelegation();
  installShortcuts();
}

function installDelegation(): void {
  if (delegationInstalled) return;
  delegationInstalled = true;

  console.log("[Sweetly] controls: delegation installed");

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      // Clicks usually land on the inner <svg>/<path>, so walk up to the button.
      const control = target?.closest?.(".ViewControl") as HTMLElement | null;
      console.log(
        "[Sweetly] controls: click:",
        (target as HTMLElement | null)?.tagName,
        "-> control:",
        control?.id ?? "(none)"
      );
      if (!control) return;

      const action = ACTIONS[control.id];
      if (!action) {
        console.log("[Sweetly] controls: no action registered for id:", control.id);
        return;
      }

      try {
        action();
        console.log("[Sweetly] controls: ran action:", control.id);
      } catch (err) {
        console.error("[Sweetly] controls: action threw:", control.id, err);
      }
    },
    true
  );
}

function installShortcuts(): void {
  if (window.__sweetlyShortcutsInstalled) return;
  window.__sweetlyShortcutsInstalled = true;

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    const activeTag = (document.activeElement?.tagName || "").toLowerCase();
    if (activeTag === "input" || activeTag === "textarea") return;

    if ((e.metaKey || e.ctrlKey) && (e.key === "," || e.key === "s" || e.key === "S")) {
      e.preventDefault();
      openSettingsPanel();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      $romanization.set(!$romanization.get());
      return;
    }

    if (e.code === "Space") {
      e.preventDefault();
      api().togglePlayPause?.();
      return;
    }

    if (e.key === "ArrowRight") {
      const state = getMusicState();
      if (state?.track?.position !== undefined) {
        api().seekTo?.(state.track.position + 5);
      }
      return;
    }

    if (e.key === "ArrowLeft") {
      const state = getMusicState();
      if (state?.track?.position !== undefined) {
        api().seekTo?.(Math.max(0, state.track.position - 5));
      }
      return;
    }
  });
}

declare global {
  interface Window {
    __sweetlyShortcutsInstalled?: boolean;
  }
}
