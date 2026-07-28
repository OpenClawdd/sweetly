import { openSettingsPanel } from "../../utils/settings.ts";
import { $romanization } from "../../utils/uiState.ts";
import Fullscreen from "../../components/Utils/Fullscreen.ts";
import { ToggleCompactMode } from "../../components/Utils/CompactMode.ts";
import { getMusicState } from "./musicState.ts";

export function installViewControlBehaviour(): void {
  const api = (globalThis as unknown as { electronAPI?: any }).electronAPI ?? {};

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

  const cinemaView = document.querySelector<HTMLButtonElement>("#CinemaView");
  if (cinemaView) {
    cinemaView.onclick = (event) => {
      event.stopImmediatePropagation();
      Fullscreen.Open(true);
    };
  }

  const settings = document.querySelector<HTMLButtonElement>("#SettingsToggle");
  if (settings) {
    settings.onclick = (event) => {
      event.stopImmediatePropagation();
      openSettingsPanel();
    };
  }

  const romanization = document.querySelector<HTMLButtonElement>("#RomanizationToggle");
  if (romanization) {
    romanization.onclick = (event) => {
      event.stopImmediatePropagation();
      const current = $romanization.get();
      $romanization.set(!current);
    };
  }

  const compact = document.querySelector<HTMLButtonElement>("#CompactModeToggle");
  if (compact) {
    compact.onclick = (event) => {
      event.stopImmediatePropagation();
      ToggleCompactMode();
    };
  }

  // Global Keyboard Shortcuts
  if (!window.__sweetlyShortcutsInstalled) {
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
        api.togglePlayPause?.();
        return;
      }

      if (e.key === "ArrowRight") {
        const state = getMusicState();
        if (state?.track?.position !== undefined) {
          api.seekTo?.(state.track.position + 5);
        }
        return;
      }

      if (e.key === "ArrowLeft") {
        const state = getMusicState();
        if (state?.track?.position !== undefined) {
          api.seekTo?.(Math.max(0, state.track.position - 5));
        }
        return;
      }
    });
  }
}

declare global {
  interface Window {
    __sweetlyShortcutsInstalled?: boolean;
  }
}
