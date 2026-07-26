import React from "react";
import { AbsoluteFill, Img } from "remotion";
import type { ThumbnailProps } from "./types";

export const Thumbnail: React.FC<ThumbnailProps> = ({
  hook,
  subline,
  theme,
  imageSrc,
}) => {
  const [from, to] = theme.palette[0];
  return (
    <AbsoluteFill
      style={{ background: `linear-gradient(155deg, ${from} 0%, ${to} 100%)` }}
    >
      {imageSrc ? (
        <Img
          src={imageSrc}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.45,
          }}
        />
      ) : null}

      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 38%, rgba(255,255,255,0.10) 0%, rgba(0,0,0,0.55) 75%)",
        }}
      />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "0 96px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: theme.textColor,
            fontFamily: theme.fontFamily,
            fontSize: 118,
            fontWeight: 900,
            lineHeight: 1.05,
            letterSpacing: -3,
            textWrap: "balance",
            textShadow: "0 18px 60px rgba(0,0,0,0.6)",
          }}
        >
          {hook}
        </div>

        {subline ? (
          <div
            style={{
              marginTop: 44,
              padding: "18px 38px",
              borderRadius: 999,
              background: theme.accent,
              color: "#111827",
              fontFamily: theme.fontFamily,
              fontSize: 44,
              fontWeight: 800,
            }}
          >
            {subline}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
