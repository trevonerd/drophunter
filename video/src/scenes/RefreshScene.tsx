import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { useBaseTimeline } from "../timing";

const CAMPAIGNS = ["Marvel Rivals", "Path of Exile 2", "FragPunk"];

export const RefreshScene: React.FC = () => {
  const { frame, fps } = useBaseTimeline();

  const cardIn = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  const syncIn = spring({
    frame: Math.max(0, frame - 36),
    fps,
    config: { damping: 16, stiffness: 130 },
  });
  const spinnerRotation = interpolate(frame, [0, 90], [0, 360], {
    extrapolateLeft: "extend",
    extrapolateRight: "extend",
  });
  const scanProgress = interpolate(frame, [22, 108], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
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
            "radial-gradient(circle at 24% 26%, rgba(125,211,252,0.18) 0%, transparent 28%), radial-gradient(circle at 78% 70%, rgba(145,70,255,0.16) 0%, transparent 32%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 150,
          left: 180,
          maxWidth: 570,
        }}
      >
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "#7dd3fc",
          }}
        >
          Clean campaign refresh
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
          Keep the dropdown focused on farmable drops.
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
          DropHunter refreshes from Twitch, filters noisy reward-only entries, and shows one clear loading state.
        </div>
      </div>

      <div
        style={{
          opacity: cardIn,
          transform: `translateY(${interpolate(cardIn, [0, 1], [46, 0])}px) scale(${interpolate(cardIn, [0, 1], [0.93, 1])})`,
          width: 490,
          padding: 28,
          borderRadius: 28,
          background: "rgba(18,18,24,0.96)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
          position: "absolute",
          right: 190,
          top: 220,
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
            Campaigns
          </div>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 14,
              background: "rgba(125,211,252,0.12)",
              border: "1px solid rgba(125,211,252,0.26)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#7dd3fc"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: `rotate(${spinnerRotation}deg)` }}
            >
              <path d="M21 12a9 9 0 0 1-15.4 6.4" />
              <path d="M3 12A9 9 0 0 1 18.4 5.6" />
              <path d="M18 2v4h4" />
              <path d="M6 22v-4H2" />
            </svg>
          </div>
        </div>

        <div
          style={{
            padding: "16px 18px",
            borderRadius: 18,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <div
              style={{
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: 14,
                color: "rgba(255,255,255,0.48)",
              }}
            >
              Select campaign
            </div>
            <div
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(34,197,94,0.14)",
                border: "1px solid rgba(34,197,94,0.28)",
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: 12,
                fontWeight: 800,
                color: "#bbf7d0",
              }}
            >
              Farmable only
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {CAMPAIGNS.map((campaign, index) => {
              const rowIn = spring({
                frame: Math.max(0, frame - 18 - index * 8),
                fps,
                config: { damping: 16, stiffness: 140 },
              });
              return (
                <div
                  key={campaign}
                  style={{
                    opacity: rowIn,
                    transform: `translateX(${interpolate(rowIn, [0, 1], [18, 0])}px)`,
                    padding: "12px 14px",
                    borderRadius: 14,
                    background: index === 0 ? "rgba(145,70,255,0.18)" : "rgba(255,255,255,0.05)",
                    border:
                      index === 0
                        ? "1px solid rgba(145,70,255,0.34)"
                        : "1px solid rgba(255,255,255,0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      fontSize: 16,
                      fontWeight: 700,
                      color: "white",
                    }}
                  >
                    {campaign}
                  </span>
                  <span
                    style={{
                      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      fontSize: 12,
                      fontWeight: 800,
                      color: index === 0 ? "#d8b4fe" : "rgba(255,255,255,0.48)",
                    }}
                  >
                    {index === 0 ? "Selected" : "Available"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            height: 8,
            marginTop: 18,
            borderRadius: 999,
            background: "rgba(255,255,255,0.07)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${scanProgress * 100}%`,
              height: "100%",
              borderRadius: 999,
              background: "linear-gradient(90deg, #7dd3fc, #a970ff)",
            }}
          />
        </div>

        <div
          style={{
            marginTop: 16,
            opacity: syncIn,
            transform: `translateY(${interpolate(syncIn, [0, 1], [14, 0])}px)`,
            padding: "13px 15px",
            borderRadius: 16,
            background: "rgba(34,197,94,0.12)",
            border: "1px solid rgba(34,197,94,0.25)",
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 15,
            fontWeight: 700,
            color: "#bbf7d0",
          }}
        >
          Campaign list synced from Twitch.
        </div>
      </div>
    </AbsoluteFill>
  );
};
