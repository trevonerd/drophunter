import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const MODES: { key: string; label: string }[] = [
  { key: "low-view", label: "Lowest viewers" },
  { key: "random", label: "Random" },
  { key: "top-viewers", label: "Most viewers" },
];

export const SettingsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardIn = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  const langIn = spring({
    frame: Math.max(0, frame - 45),
    fps,
    config: { damping: 16, stiffness: 130 },
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
          inset: 0,
          background:
            "radial-gradient(circle at 20% 30%, rgba(145,70,255,0.22) 0%, transparent 28%), radial-gradient(circle at 80% 70%, rgba(0,212,170,0.12) 0%, transparent 30%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 150,
          left: 180,
          maxWidth: 560,
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
          Streamer selection
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 50,
            fontWeight: 800,
            letterSpacing: -1.4,
            lineHeight: 1.04,
            color: "white",
          }}
        >
          Your farming,
          <br />
          your rules.
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
           Pick your preferred streamer style and filter by language — DropHunter handles the rest.
        </div>
      </div>

      <div
        style={{
          transform: `translateY(${interpolate(cardIn, [0, 1], [50, 0])}px) scale(${interpolate(cardIn, [0, 1], [0.92, 1])})`,
          opacity: cardIn,
          width: 470,
          padding: 28,
          borderRadius: 28,
          background: "rgba(18,18,24,0.96)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
          position: "absolute",
          right: 190,
          top: 230,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 22,
          }}
        >
          <div
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 1.2,
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.45)",
            }}
          >
            Settings
          </div>
          <div
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              background: "rgba(145,70,255,0.14)",
              border: "1px solid rgba(145,70,255,0.28)",
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 13,
              fontWeight: 700,
              color: "#d8b4fe",
            }}
          >
            Customizable
          </div>
        </div>

        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.38)",
            marginBottom: 12,
          }}
        >
          Streamer selection mode
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {MODES.map((mode, index) => {
            const chipIn = spring({
              frame: Math.max(0, frame - 10 - index * 8),
              fps,
              config: { damping: 16, stiffness: 150 },
            });
            const isActive = index === 0;
            return (
              <div
                key={mode.key}
                style={{
                  opacity: chipIn,
                  transform: `translateY(${interpolate(chipIn, [0, 1], [12, 0])}px) scale(${interpolate(chipIn, [0, 1], [0.92, 1])})`,
                  padding: "12px 18px",
                  borderRadius: 999,
                  background: isActive
                    ? "rgba(145,70,255,0.18)"
                    : "rgba(255,255,255,0.06)",
                  border: isActive
                    ? "1px solid rgba(145,70,255,0.34)"
                    : "1px solid rgba(255,255,255,0.08)",
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  fontSize: 15,
                  fontWeight: 600,
                  color: isActive ? "#d8b4fe" : "rgba(255,255,255,0.82)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {isActive && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a970ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {mode.label}
              </div>
            );
          })}
        </div>

        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.07)",
            margin: "22px 0",
          }}
        />

        <div
          style={{
            opacity: langIn,
            transform: `translateY(${interpolate(langIn, [0, 1], [14, 0])}px)`,
          }}
        >
          <div
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.38)",
              marginBottom: 10,
            }}
          >
            Language filter
          </div>
          <div
            style={{
              padding: "14px 18px",
              borderRadius: 18,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.09)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 20 }}>🌐</span>
              <div>
                <div
                  style={{
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    fontSize: 15,
                    fontWeight: 700,
                    color: "white",
                  }}
                >
                  Language: English
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    fontSize: 12,
                    color: "rgba(255,255,255,0.45)",
                  }}
                >
                  30+ languages supported
                </div>
              </div>
            </div>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
