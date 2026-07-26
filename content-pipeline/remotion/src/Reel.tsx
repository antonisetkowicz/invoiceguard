import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { SceneView } from "./Scene";
import type { ReelProps } from "./types";

/**
 * Sceny są skalowane proporcjonalnie do RZECZYWISTEJ długości lektora
 * (audioDurationS z kroku 3), więc obraz nigdy nie rozjeżdża się z głosem —
 * scenariusz podaje tylko proporcje.
 */
export const Reel: React.FC<ReelProps> = ({
  scenes,
  audioDurationS,
  theme,
  handle,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const plannedTotal = scenes.reduce((sum, s) => sum + (s.duration_s || 0), 0);
  const scale = plannedTotal > 0 ? (audioDurationS || plannedTotal) / plannedTotal : 1;

  let cursor = 0;
  const timeline = scenes.map((scene, index) => {
    const from = Math.round(cursor * fps);
    const isLast = index === scenes.length - 1;
    cursor += (scene.duration_s || 0) * scale;
    const to = isLast ? durationInFrames : Math.round(cursor * fps);
    return { scene, from, length: Math.max(1, to - from) };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {timeline.map(({ scene, from, length }, index) => (
        <Sequence key={index} from={from} durationInFrames={length}>
          <SceneView
            scene={scene}
            theme={theme}
            index={index}
            durationInFrames={length}
          />
        </Sequence>
      ))}

      {handle ? (
        <AbsoluteFill
          style={{
            justifyContent: "flex-start",
            alignItems: "center",
            paddingTop: 120,
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.72)",
              fontFamily: theme.fontFamily,
              fontSize: 36,
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            {handle}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
