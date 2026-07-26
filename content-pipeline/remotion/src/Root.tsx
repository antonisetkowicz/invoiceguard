import React from "react";
import { Composition, Still } from "remotion";
import { Reel } from "./Reel";
import { Thumbnail } from "./Thumbnail";
import { DEFAULT_THEME, type ReelProps, type ThumbnailProps } from "./types";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

const demoProps: ReelProps = {
  fps: FPS,
  audioDurationS: 12,
  theme: DEFAULT_THEME,
  handle: "",
  scenes: [
    {
      text: "Tracisz 3 godziny tygodniowo na fakturach?",
      duration_s: 3,
      visual: { kind: "text", headline: "3 godziny tygodniowo" },
    },
    {
      text: "Oto trzy rzeczy, które to zmieniają.",
      duration_s: 5,
      visual: { kind: "list", items: ["Automatyczny odczyt", "Kontrola stawek", "Alert o duplikacie"] },
    },
    {
      text: "Zapisz to sobie na później.",
      duration_s: 4,
      visual: { kind: "quote", headline: "Zapisz na później" },
    },
  ],
};

const demoThumb: ThumbnailProps = {
  hook: "Tracisz 3 godziny tygodniowo na fakturach?",
  subline: "3 sposoby",
  theme: DEFAULT_THEME,
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Reel"
      component={Reel}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={FPS * 12}
      defaultProps={demoProps}
      calculateMetadata={({ props }) => {
        const fps = props.fps || FPS;
        const planned = props.scenes.reduce(
          (sum, s) => sum + (s.duration_s || 0),
          0,
        );
        // Długość wideo = długość lektora (z zapasem 0.4 s na wybrzmienie).
        const seconds = (props.audioDurationS || planned || 10) + 0.4;
        return { durationInFrames: Math.max(1, Math.round(seconds * fps)), fps };
      }}
    />

    <Still
      id="Thumbnail"
      component={Thumbnail}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={demoThumb}
    />
  </>
);
