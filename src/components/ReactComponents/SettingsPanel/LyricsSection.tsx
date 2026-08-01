import { useStore } from "@nanostores/react";
import React from "react";
import {
  $minimalLyricsMode,
  $forceWordLevel,
  $simpleLyricsMode,
  $simpleLyricsModeRenderingType,
} from "../../../utils/stores.ts";
import { matches, Row, Select, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Lyrics Display";
const renderingTypeOptions = ["calculate", "animate"];

interface Props {
  query: string;
  sectionFilter: string;
}

export default function LyricsSection({ query, sectionFilter }: Props) {
  const simpleLyricsMode = useStore($simpleLyricsMode);
  const simpleLyricsModeRenderingType = useStore($simpleLyricsModeRenderingType);
  const minimalLyricsMode = useStore($minimalLyricsMode);
  const forceWordLevel = useStore($forceWordLevel);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const r1 = matches(query, "Simple Lyrics Mode", "Remove extra visual effects from lyrics");
  const r2 = matches(
    query,
    "Simple Mode: Text Animation Style",
    "How lyrics text transitions are rendered in Simple Lyrics Mode."
  );
  const r3 = matches(
    query,
    "Minimal Lyrics Mode",
    "Hides sung lyrics lines in Fullscreen and Cinema Mode"
  );
  const r4 = matches(
    query,
    "Force Word-Level Lyrics",
    "Splits line-level lyrics into words for per-word animation"
  );

  if (!r1 && !r2 && !r3 && !r4) return null;

  return (
    <>
      <SectionTitle>Lyrics Display</SectionTitle>

      {r1 && (
        <Row label="Simple Lyrics Mode" description="Remove extra visual effects from lyrics">
          <Toggle checked={simpleLyricsMode} onChange={(v) => $simpleLyricsMode.set(v)} />
        </Row>
      )}

      {r2 && (
        <Row
          label="Simple Mode: Text Animation Style"
          description="How lyrics text transitions are rendered in Simple Lyrics Mode."
          disabled={!simpleLyricsMode}
          disabledReason="Enable Simple Lyrics Mode to modify this setting"
        >
          <Select
            value={simpleLyricsModeRenderingType}
            options={renderingTypeOptions}
            onChange={(v) => $simpleLyricsModeRenderingType.set(v)}
            disabled={!simpleLyricsMode}
          />
        </Row>
      )}

      {r3 && (
        <Row
          label="Minimal Lyrics Mode"
          description="Hides sung lyrics lines in Fullscreen and Cinema Mode"
        >
          <Toggle checked={minimalLyricsMode} onChange={(v) => $minimalLyricsMode.set(v)} />
        </Row>
      )}

      {r4 && (
        <Row
          label="Force Word-Level Lyrics"
          description="Splits line-level lyrics into words for per-word animation"
        >
          <Toggle
            checked={forceWordLevel}
            onChange={(v) => {
              $forceWordLevel.set(v);
              // Fire an event to tell the lyrics to reload so the change is instant.
              window.dispatchEvent(new Event("lyrics-config-changed"));
            }}
          />
        </Row>
      )}
    </>
  );
}
