import React from "react";
import {
  AbsoluteFill,
  Img,
  Loop,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Scene, Theme } from "./types";

const gradient = (colors: [string, string]) =>
  `linear-gradient(160deg, ${colors[0]} 0%, ${colors[1]} 100%)`;

/** Delikatny ruch tła — bez tego statyczny gradient wygląda jak slajd. */
const useDrift = (durationInFrames: number) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: "clamp",
  });
  return {
    scale: 1.06 + progress * 0.08,
    shift: interpolate(progress, [0, 1], [-18, 18]),
  };
};

const useEntrance = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200, mass: 0.6 } });
  return {
    opacity: interpolate(enter, [0, 1], [0, 1]),
    translateY: interpolate(enter, [0, 1], [60, 0]),
  };
};

const Headline: React.FC<{
  text: string;
  theme: Theme;
  size?: number;
  weight?: number;
}> = ({ text, theme, size = 96, weight = 800 }) => {
  const { opacity, translateY } = useEntrance();
  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        color: theme.textColor,
        fontFamily: theme.fontFamily,
        fontSize: size,
        fontWeight: weight,
        lineHeight: 1.1,
        letterSpacing: -2,
        textAlign: "center",
        textWrap: "balance",
        textShadow: "0 12px 40px rgba(0,0,0,0.45)",
      }}
    >
      {text}
    </div>
  );
};

/**
 * Ujęcie stockowe w tle. Klip często jest krótszy niż scena — wtedy zapętlamy
 * go komponentem <Loop>, bo OffthreadVideo nie ma własnego zapętlania i po
 * końcu materiału pokazywałby czarne klatki.
 */
const Footage: React.FC<{
  clip: string;
  clipDurationS?: number;
  durationInFrames: number;
  scale: number;
}> = ({ clip, clipDurationS, durationInFrames, scale }) => {
  const { fps } = useVideoConfig();
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: `scale(${scale})`,
  };
  const video = <OffthreadVideo src={staticFile(clip)} muted style={style} />;

  // -2 klatki zapasu: ostatnia klatka klipu bywa uszkodzona po transkodowaniu
  const clipFrames = clipDurationS
    ? Math.max(1, Math.floor(clipDurationS * fps) - 2)
    : null;

  if (clipFrames && clipFrames < durationInFrames) {
    return <Loop durationInFrames={clipFrames}>{video}</Loop>;
  }
  return video;
};

const Shapes: React.FC<{ theme: Theme }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const circles = [0, 1, 2, 3];
  return (
    <AbsoluteFill>
      {circles.map((i) => {
        const phase = frame / fps + i * 1.7;
        const size = 320 + i * 130;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: size,
              height: size,
              borderRadius: "50%",
              border: `3px solid ${theme.accent}`,
              opacity: 0.18,
              top: 380 + Math.sin(phase) * 90 - size / 2,
              left: 540 + Math.cos(phase * 0.8) * 120 - size / 2,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Counter: React.FC<{ scene: Scene; theme: Theme; durationInFrames: number }> = ({
  scene,
  theme,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const from = scene.visual.from ?? 0;
  const to = scene.visual.to ?? 100;
  const value = Math.round(
    interpolate(frame, [0, durationInFrames * 0.75], [from, to], {
      extrapolateRight: "clamp",
    }),
  );
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          color: theme.accent,
          fontFamily: theme.fontFamily,
          fontSize: 260,
          fontWeight: 900,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          textShadow: "0 16px 50px rgba(0,0,0,0.5)",
        }}
      >
        {value}
        {scene.visual.suffix ?? ""}
      </div>
      <Headline
        text={scene.visual.headline ?? scene.text}
        theme={theme}
        size={64}
        weight={700}
      />
    </div>
  );
};

const ListVisual: React.FC<{ scene: Scene; theme: Theme; durationInFrames: number }> = ({
  scene,
  theme,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const items = scene.visual.items ?? [];
  const step = items.length ? durationInFrames / (items.length + 1) : durationInFrames;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 34, width: "100%" }}>
      {items.map((item, index) => {
        const appear = interpolate(
          frame,
          [index * step, index * step + 10],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        return (
          <div
            key={index}
            style={{
              opacity: appear,
              transform: `translateX(${interpolate(appear, [0, 1], [-50, 0])}px)`,
              display: "flex",
              alignItems: "center",
              gap: 26,
              background: "rgba(255,255,255,0.08)",
              borderLeft: `10px solid ${theme.accent}`,
              borderRadius: 22,
              padding: "26px 30px",
            }}
          >
            <span
              style={{
                color: theme.accent,
                fontFamily: theme.fontFamily,
                fontSize: 54,
                fontWeight: 900,
              }}
            >
              {index + 1}
            </span>
            <span
              style={{
                color: theme.textColor,
                fontFamily: theme.fontFamily,
                fontSize: 52,
                fontWeight: 700,
                lineHeight: 1.15,
              }}
            >
              {item}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const Quote: React.FC<{ scene: Scene; theme: Theme }> = ({ scene, theme }) => {
  const { opacity } = useEntrance();
  return (
    <div style={{ opacity, textAlign: "center" }}>
      <div
        style={{
          color: theme.accent,
          fontFamily: theme.fontFamily,
          fontSize: 200,
          fontWeight: 900,
          lineHeight: 0.6,
        }}
      >
        &ldquo;
      </div>
      <Headline
        text={scene.visual.headline ?? scene.text}
        theme={theme}
        size={78}
        weight={700}
      />
    </div>
  );
};

export const SceneView: React.FC<{
  scene: Scene;
  theme: Theme;
  index: number;
  durationInFrames: number;
}> = ({ scene, theme, index, durationInFrames }) => {
  const colors =
    scene.visual.colors ?? theme.palette[index % theme.palette.length];
  const { scale, shift } = useDrift(durationInFrames);
  const kind = scene.visual.kind;

  return (
    <AbsoluteFill style={{ background: gradient(colors), overflow: "hidden" }}>
      {/* Ujęcie stockowe z ludźmi. Klip bywa krótszy niż scena — `loop`
          domyka lukę zamiast pokazywać czarną klatkę. */}
      {kind === "footage" && scene.visual.clip ? (
        <AbsoluteFill>
          <Footage
            clip={scene.visual.clip}
            clipDurationS={scene.visual.clipDurationS}
            durationInFrames={durationInFrames}
            scale={scale}
          />
        </AbsoluteFill>
      ) : null}

      {kind === "image" && scene.visual.src ? (
        <AbsoluteFill>
          <Img
            src={staticFile(scene.visual.src)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${scale}) translateY(${shift}px)`,
              opacity: 0.55,
            }}
          />
        </AbsoluteFill>
      ) : null}

      {kind === "shapes" ? <Shapes theme={theme} /> : null}

      {/* Przyciemnienie: pod ujęciem z ludźmi musi być mocniejsze, inaczej
          biały tekst ginie na jasnych kadrach. */}
      <AbsoluteFill
        style={{
          background:
            kind === "footage" && scene.visual.clip
              ? `linear-gradient(to bottom, rgba(0,0,0,${(scene.visual.dim ?? 0.45) * 0.9}) 0%, rgba(0,0,0,${scene.visual.dim ?? 0.45}) 45%, rgba(0,0,0,${Math.min(1, (scene.visual.dim ?? 0.45) + 0.25)}) 100%)`
              : "linear-gradient(to bottom, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "0 92px",
          paddingBottom: 520,
        }}
      >
        {kind === "counter" ? (
          <Counter scene={scene} theme={theme} durationInFrames={durationInFrames} />
        ) : kind === "list" ? (
          <ListVisual scene={scene} theme={theme} durationInFrames={durationInFrames} />
        ) : kind === "quote" ? (
          <Quote scene={scene} theme={theme} />
        ) : kind === "gradient" ? null : kind === "footage" ? (
          /* Przy ujęciu z ludźmi headline jest opcjonalny i mniejszy —
             gwiazdą sceny jest obraz, a nie napis. */
          scene.visual.headline ? (
            <Headline text={scene.visual.headline} theme={theme} size={76} />
          ) : null
        ) : (
          <Headline text={scene.visual.headline ?? scene.text} theme={theme} />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
