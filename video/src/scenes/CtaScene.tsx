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

export const CtaScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const btnProgress = spring({
    frame: Math.max(0, frame - 25),
    fps,
    config: { damping: 16, stiffness: 110 },
  });
  const pulse = (Math.sin(frame * 0.08) + 1) / 2;

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
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(145,70,255,0.18) 0%, transparent 58%)",
          opacity: 0.4 + pulse * 0.4,
          filter: "blur(70px)",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>
        <div style={{ transform: `scale(${logoScale})` }}>
          <Img
            src={staticFile("icon.svg")}
            style={{
              width: 100,
              height: 100,
              filter: "drop-shadow(0 0 30px rgba(145,70,255,0.5))",
            }}
          />
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 54,
              fontWeight: 800,
              color: "white",
              letterSpacing: -1.4,
              lineHeight: 1.05,
            }}
          >
            Stop babysitting Twitch tabs.
          </div>
          <div
            style={{
              marginTop: 12,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 24,
              color: "rgba(255,255,255,0.68)",
            }}
          >
            Install the Chrome extension that queues campaigns, tracks progress, and auto-claims rewards.
          </div>
        </div>
        <div
          style={{
            opacity: btnProgress,
            transform: `scale(${interpolate(btnProgress, [0, 1], [0.85, 1])})`,
            padding: "16px 48px",
            borderRadius: 14,
            background: "linear-gradient(135deg, #9146ff, #772ce8)",
            boxShadow: `0 0 35px rgba(145,70,255,${0.4 + pulse * 0.2})`,
          }}
        >
          <span
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 24,
              fontWeight: 700,
              color: "white",
            }}
          >
            Install the Chrome extension
          </span>
        </div>
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 20,
            color: "rgba(255,255,255,0.46)",
          }}
        >
          github.com/trevonerd/drophunter
        </div>
      </div>
    </AbsoluteFill>
  );
};
