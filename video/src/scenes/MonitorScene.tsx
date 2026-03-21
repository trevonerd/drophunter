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
          See what is moving right now.
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
          Progress, ETA, active streamer, and recovery status stay visible at a glance.
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
          Campaign Bravo
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              padding: "7px 12px",
              borderRadius: 999,
              background: "rgba(34,197,94,0.14)",
              border: "1px solid rgba(34,197,94,0.28)",
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 13,
              fontWeight: 700,
              color: "#bbf7d0",
            }}
          >
            RUNNING
          </div>
          <div
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 14,
              color: "rgba(255,255,255,0.56)",
            }}
          >
            /streamer_name
          </div>
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
          {Math.round(progress * 100)}% • ETA 14m
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
        <div
          style={{
            marginTop: 18,
            padding: "12px 14px",
            borderRadius: 14,
            background: "rgba(255,180,80,0.12)",
            border: "1px solid rgba(255,180,80,0.22)",
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 14,
            fontWeight: 600,
            color: "rgba(255,236,204,0.9)",
            opacity: interpolate(frame, [84, 120], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          If recovery kicks in, you see it here too.
        </div>
      </div>
    </AbsoluteFill>
  );
};
