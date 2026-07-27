/**
 * Rebinds the two PageView controls whose upstream behaviour assumes Spotify:
 * Close would dismiss a Spotify page, and Fullscreen uses the DOM Fullscreen
 * API rather than the Electron window. Every other ViewControl works unchanged.
 */
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
}
