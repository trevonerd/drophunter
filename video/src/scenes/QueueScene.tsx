import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const CAMPAIGNS = [
  { label: "Game A", color: "#9146ff" },
  { label: "Game B", color: "#772ce8" },
  { label: "Game C", color: "#5c1cb8" },
];

export const QueueScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

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
          width: 500,
          height: 500,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(145,70,255,0.12) 0%, transparent 55%)",
          filter: "blur(50px)",
        }}
      />
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
          Queue campaigns
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
          Build your farming queue in seconds.
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
          Use the extension popup to pick multiple campaigns and let DropHunter move through them automatically.
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
        {CAMPAIGNS.map((c, i) => {
          const progress = spring({
            frame: Math.max(0, frame - 15 - i * 18),
            fps,
            config: { damping: 18, stiffness: 140 },
          });
          const x = interpolate(progress, [0, 1], [-80, 0]);
          const opacity = interpolate(progress, [0, 0.5], [0, 1], { extrapolateRight: "clamp" });
          return (
            <div
              key={c.label}
              style={{
                opacity,
                transform: `translateX(${x}px)`,
                width: 320,
                padding: "20px 28px",
                borderRadius: 16,
                background: "rgba(255,255,255,0.06)",
                border: `2px solid ${c.color}40`,
                boxShadow: `0 0 30px ${c.color}20`,
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: `linear-gradient(135deg, ${c.color}, ${c.color}99)`,
                }}
              />
              <span
                style={{
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  fontSize: 22,
                  fontWeight: 600,
                  color: "white",
                }}
              >
                {c.label}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
