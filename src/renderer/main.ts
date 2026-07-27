/**
 * Sweetly renderer entry. Models src/app.tsx, minus everything that exists to
 * embed into Spotify's chrome: NPVLyrics, PopupLyrics, the now-playing-bar
 * observers, the update dialog and the data migration.
 *
 * Import order is load-bearing. Static ESM imports are hoisted and run before
 * this module's body, so upstream JS is pulled in with dynamic import() after
 * installSpicetifyShim() has run — several upstream modules read Spicetify at
 * module scope and would throw otherwise. Stylesheets are safe as static
 * imports because they execute no JavaScript.
 */
import "../css/tokens.css";
import "../css/primitives.css";
import "../css/default.css";
import "../css/default.scss";
import "../css/Simplebar.css";
import "../css/ContentBox.css";
import "../css/DynamicBG/spicy-dynamic-bg.css";
import "../css/Lyrics/main.css";
import "../css/Lyrics/Mixed.css";
import "../css/Loaders/LoaderContainer.css";
import "../css/font-pack/font-pack.css";
import "../css/settings-panel.css";
import "tippy.js/dist/tippy.css";

import { installSpicetifyShim } from "./adapter/spicetifyShim.ts";
import {
  subscribeMusicState,
  onMusicStateChange,
  getMusicState,
} from "./adapter/musicState.ts";
import { setProgressProvider } from "./adapter/AppleMusicPlayer.ts";

installSpicetifyShim();

function trackKey(): string | null {
  const track = getMusicState().track;
  if (!track) return null;
  return `${track.artistCleaned}--${track.nameCleaned}`;
}

async function start(): Promise<void> {
  const [
    pageViewModule,
    dynamicBgModule,
    fontsModule,
    nowBarModule,
    applyerModule,
    progressModule,
  ] = await Promise.all([
    import("../components/Pages/PageView.ts"),
    import("../components/DynamicBG/dynamicBackground.ts"),
    import("../components/Styling/Fonts.ts"),
    import("../components/Utils/NowBar.ts"),
    import("../utils/Lyrics/Global/Applyer.ts"),
    import("../utils/Gets/GetProgress.ts"),
  ]);

  const PageView = pageViewModule.default;
  const ApplyDynamicBackground = dynamicBgModule.default;
  const LoadFonts = fontsModule.default;
  const { ApplyFontPixel } = fontsModule;
  const { UpdateNowBar } = nowBarModule;
  const ApplyLyrics = applyerModule.default;

  // Hand upstream's smoothed clock to the adapter. Doing it here rather than by
  // import avoids an ESM cycle — see the comment in AppleMusicPlayer.ts.
  setProgressProvider(progressModule.default);

  const { fetchLyricsForCurrentTrack } = await import("./lyrics/fetchLyricsElectron.ts");
  const { installViewControlBehaviour } = await import("./adapter/viewControls.ts");

  LoadFonts();
  ApplyFontPixel();

  subscribeMusicState();

  const mount = document.getElementById("app");
  if (!mount) throw new Error("#app mount point missing from index.html");
  await PageView.Open(mount);

  installViewControlBehaviour();

  let lastKey: string | null = null;

  async function loadLyricsForCurrentTrack(): Promise<void> {
    const result = await fetchLyricsForCurrentTrack();

    const background = document.querySelector<HTMLElement>(".spicy-dynamic-bg");
    if (background) void ApplyDynamicBackground(background);

    await ApplyLyrics(result as any);
  }

  onMusicStateChange((state) => {
    UpdateNowBar();
    progressModule.requestPositionSync();

    const key = state.track ? `${state.track.artistCleaned}--${state.track.nameCleaned}` : null;
    if (key === lastKey) return;
    lastKey = key;
    if (!key) return;

    void loadLyricsForCurrentTrack();
  });

  // A music-update may already have landed before we subscribed.
  if (trackKey()) {
    lastKey = trackKey();
    UpdateNowBar();
    await loadLyricsForCurrentTrack();
  }
}

void start().catch((error) => {
  console.error("[Sweetly] renderer failed to start:", error);
});
