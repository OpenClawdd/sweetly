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
import { LyricsObject, ScrollingIntervalTime } from "../utils/Lyrics/lyrics.ts";
import {
  $lyricsContainerExists,
  $currentLyricsType,
  $currentLyricsData,
  $currentlyFetching,
} from "../utils/stores.ts";

// Auto-scroll, reproducing app.tsx:765-769. All three modules are already
// evaluated inside PageView.ts's subtree (PageView.ts:16-20 pulls
// ScrollToActiveLine.ts and ScrollSimplebar.ts; ScrollSimplebar.ts:2 pulls
// IntervalManager.ts), so these statements only bind — they add no module to
// the graph and cannot perturb the evaluation order this file exists to protect.
//
// ScrollSimplebar is `export let`: ClearScrollSimplebar() nulls it on every
// ApplyLyrics (Applyer.ts:53) and MountScrollSimplebar() reassigns it
// (Syllable.ts:539). Re-exporting keeps the binding live, so consumers must read
// it through the module namespace and must never destructure it.
import { IntervalManager } from "../utils/IntervalManager.ts";
import { ScrollToActiveLine } from "../utils/Scrolling/ScrollToActiveLine.ts";
import { ScrollSimplebar } from "../utils/Scrolling/Simplebar/ScrollSimplebar.ts";

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
  LyricsObject,
  ScrollingIntervalTime,
  $lyricsContainerExists,
  $currentLyricsType,
  $currentLyricsData,
  $currentlyFetching,
  IntervalManager,
  ScrollToActiveLine,
  ScrollSimplebar,
};
