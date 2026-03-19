import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const MonitorScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const windowIn = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  const progress = interpolate(frame, [24, 156], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const badgePulse = (Math.sin(frame * 0.12) + 1) / 2;

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
          top: 150,
          left: 180,
          maxWidth: 520,
        }}
      >
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "#a970ff",
          }}
        >
          Live monitor
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 48,
            fontWeight: 800,
            letterSpacing: -1.2,
            lineHeight: 1.05,
            color: "white",
          }}
        >
          Watch progress from 0 to 100.
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 22,
            lineHeight: 1.4,
            color: "rgba(255,255,255,0.68)",
          }}
        >
          The Chrome extension shows watch time, reward progress, and farming status without leaving Twitch.
        </div>
      </div>
      <div
        style={{
          opacity: windowIn,
          transform: `scale(${interpolate(windowIn, [0, 1], [0.9, 1])})`,
          width: 420,
          padding: 28,
          borderRadius: 20,
          background: "rgba(20,20,24,0.95)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.42)",
            marginBottom: 16,
          }}
        >
          Farming now
        </div>
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 24,
            fontWeight: 700,
            color: "white",
            marginBottom: 10,
          }}
        >
          Chrome extension monitor
        </div>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "linear-gradient(135deg, #9146ff, #772ce8)",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 20px rgba(145,70,255,${0.3 + badgePulse * 0.2})`,
          }}
        />
        <div
          style={{
            height: 12,
            borderRadius: 6,
            background: "rgba(255,255,255,0.1)",
            overflow: "hidden",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: "100%",
              borderRadius: 6,
              background: "linear-gradient(90deg, #9146ff, #a970ff)",
              transition: "none",
            }}
          />
        </div>
        <span
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 18,
            color: "rgba(255,255,255,0.6)",
          }}
        >
          {Math.round(progress * 100)}%
        </span>
        <div
          style={{
            marginTop: 10,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 16,
            color: "rgba(255,255,255,0.5)",
          }}
        >
          Reward progress updates live.
        </div>
      </div>
    </AbsoluteFill>
  );
};
