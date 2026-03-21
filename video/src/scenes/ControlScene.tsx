import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const QUEUE = ["Campaign Alpha", "Campaign Bravo", "Campaign Charlie"];

export const ControlScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardIn = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  const buttonIn = spring({
    frame: Math.max(0, frame - 18),
    fps,
    config: { damping: 18, stiffness: 130 },
  });
  const monitorIn = spring({
    frame: Math.max(0, frame - 42),
    fps,
    config: { damping: 18, stiffness: 130 },
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
            "radial-gradient(circle at 22% 22%, rgba(145,70,255,0.24) 0%, transparent 28%), radial-gradient(circle at 78% 72%, rgba(0,212,170,0.14) 0%, transparent 32%)",
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
            color: "#7dd3fc",
          }}
        >
          One popup. Full control.
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
          Pick a campaign.
          <br />
          Hit start. Walk away.
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 22,
            lineHeight: 1.4,
            color: "rgba(255,255,255,0.72)",
          }}
        >
          Queue campaigns, pause when you want, and pop open the live monitor from the same Chrome popup.
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
            DropHunter popup
          </div>
          <div
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              background: "rgba(34,197,94,0.14)",
              border: "1px solid rgba(34,197,94,0.28)",
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 13,
              fontWeight: 700,
              color: "#bbf7d0",
            }}
          >
            Ready
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
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 14,
              color: "rgba(255,255,255,0.48)",
            }}
          >
            Selected campaign
          </div>
          <div
            style={{
              marginTop: 8,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 24,
              fontWeight: 700,
              color: "white",
            }}
          >
            Campaign Alpha
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
          {QUEUE.map((label, index) => {
            const chipIn = spring({
              frame: Math.max(0, frame - 10 - index * 7),
              fps,
              config: { damping: 16, stiffness: 150 },
            });
            return (
              <div
                key={label}
                style={{
                  opacity: chipIn,
                  transform: `translateY(${interpolate(chipIn, [0, 1], [12, 0])}px) scale(${interpolate(chipIn, [0, 1], [0.92, 1])})`,
                  padding: "10px 14px",
                  borderRadius: 999,
                  background: index === 0 ? "rgba(145,70,255,0.18)" : "rgba(255,255,255,0.06)",
                  border:
                    index === 0
                      ? "1px solid rgba(145,70,255,0.34)"
                      : "1px solid rgba(255,255,255,0.08)",
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  fontSize: 14,
                  fontWeight: 600,
                  color: "white",
                }}
              >
                {label}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 24 }}>
          <div
            style={{
              flex: 1,
              opacity: buttonIn,
              transform: `scale(${interpolate(buttonIn, [0, 1], [0.9, 1])})`,
              padding: "16px 18px",
              borderRadius: 18,
              background: "linear-gradient(135deg, #22c55e, #16a34a)",
              boxShadow: "0 14px 34px rgba(34,197,94,0.18)",
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 18,
              fontWeight: 800,
              color: "white",
              textAlign: "center",
            }}
          >
            Start farming
          </div>
          <div
            style={{
              width: 132,
              opacity: buttonIn,
              transform: `scale(${interpolate(buttonIn, [0, 1], [0.9, 1])})`,
              padding: "16px 18px",
              borderRadius: 18,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 18,
              fontWeight: 700,
              color: "rgba(255,255,255,0.88)",
              textAlign: "center",
            }}
          >
            Pause
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            opacity: monitorIn,
            transform: `translateY(${interpolate(monitorIn, [0, 1], [14, 0])}px)`,
            padding: "14px 16px",
            borderRadius: 18,
            background: "rgba(125,211,252,0.09)",
            border: "1px solid rgba(125,211,252,0.22)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: 15,
                fontWeight: 700,
                color: "white",
              }}
            >
              Open live monitor
            </div>
            <div
              style={{
                marginTop: 4,
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: 13,
                color: "rgba(255,255,255,0.58)",
              }}
            >
              Keep progress visible while Twitch keeps running.
            </div>
          </div>
          <div
            style={{
              width: 52,
              height: 30,
              borderRadius: 999,
              background: "rgba(34,197,94,0.22)",
              border: "1px solid rgba(34,197,94,0.32)",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: 2,
                top: 2,
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: "white",
              }}
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
