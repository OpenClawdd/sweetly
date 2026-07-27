/**
 * Single entry into upstream Spicy's module graph.
 *
 * Why this file exists: upstream has import cycles (PageView.ts exports a
 * mutable `PageContainer` that Applyer.ts and the applyers read), and ESM only
 * resolves those safely when the graph is evaluated in one deterministic
 * depth-first pass. Importing the modules individually with Promise.all
 * evaluates them concurrently in an order app.tsx never produces, which throws
 * "Cannot access 'PageContainer' before initialization".
 *
 * So: static imports here, in app.tsx's order, and main.ts pulls in this one
 * module dynamically after the Spicetify shim is installed.
 */
import ApplyDynamicBackground from "../components/DynamicBG/dynamicBackground.ts";
import PageView, { GetPageRoot, PageContainer } from "../components/Pages/PageView.ts";
import LoadFonts, { ApplyFontPixel } from "../components/Styling/Fonts.ts";
import Fullscreen, {
  EnterSpicyLyricsFullscreen,
  ExitFullscreenElement,
} from "../components/Utils/Fullscreen.ts";
import { UpdateNowBar } from "../components/Utils/NowBar.ts";
import ApplyLyrics from "../utils/Lyrics/Global/Applyer.ts";
import GetProgress, { requestPositionSync } from "../utils/Gets/GetProgress.ts";
import { openSettingsPanel } from "../utils/settings.ts";

export {
  ApplyDynamicBackground,
  PageView,
  GetPageRoot,
  PageContainer,
  LoadFonts,
  ApplyFontPixel,
  Fullscreen,
  EnterSpicyLyricsFullscreen,
  ExitFullscreenElement,
  UpdateNowBar,
  ApplyLyrics,
  GetProgress,
  requestPositionSync,
  openSettingsPanel,
};
