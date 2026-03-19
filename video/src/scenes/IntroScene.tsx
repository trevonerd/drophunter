import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const taglineOpacity = spring({
    frame: Math.max(0, frame - 20),
    fps,
    config: { damping: 20, stiffness: 100 },
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#0e0e10",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(145,70,255,0.15) 0%, transparent 60%)",
          filter: "blur(60px)",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ transform: `scale(${logoScale})` }}>
          <Img
            src={staticFile("icon.svg")}
            style={{
              width: 160,
              height: 160,
              filter: "drop-shadow(0 0 40px rgba(145,70,255,0.6))",
            }}
          />
        </div>
        <span
          style={{
            marginTop: 24,
            opacity: taglineOpacity,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 28,
            fontWeight: 600,
            color: "rgba(255,255,255,0.9)",
            letterSpacing: 2,
          }}
        >
          DropHunter
        </span>
        <div
          style={{
            marginTop: 22,
            opacity: taglineOpacity,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 54,
              fontWeight: 800,
              color: "white",
              letterSpacing: -1.5,
              lineHeight: 1.05,
            }}
          >
            The Chrome extension
            <br />
            for Twitch Drops
          </div>
          <div
            style={{
              marginTop: 12,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 24,
              fontWeight: 500,
              color: "rgba(255,255,255,0.68)",
            }}
          >
            Queue campaigns, monitor progress, auto-claim rewards, and recover playback fast.
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
