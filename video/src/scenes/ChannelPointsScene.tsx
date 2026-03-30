import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const ChannelPointsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const chatIn = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  const buttonPop = spring({
    frame: Math.max(0, frame - 30),
    fps,
    config: { damping: 12, stiffness: 140 },
  });
  const clickEffect = spring({
    frame: Math.max(0, frame - 55),
    fps,
    config: { damping: 14, stiffness: 160 },
  });
  const claimedBadge = spring({
    frame: Math.max(0, frame - 70),
    fps,
    config: { damping: 12, stiffness: 130 },
  });

  const buttonBg = interpolate(clickEffect, [0, 1], [0, 1]);
  const buttonLabel = clickEffect > 0.5 ? "Claimed!" : "+50 Bonus";

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
            "radial-gradient(circle at 25% 35%, rgba(145,70,255,0.20) 0%, transparent 30%), radial-gradient(circle at 75% 65%, rgba(119,44,232,0.12) 0%, transparent 28%)",
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
          Channel points
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
          Grab every bonus
          <br />
          automatically.
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
          Free channel points — claimed while you watch.
        </div>
      </div>

      <div
        style={{
          transform: `translateY(${interpolate(chatIn, [0, 1], [50, 0])}px) scale(${interpolate(chatIn, [0, 1], [0.92, 1])})`,
          opacity: chatIn,
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
            Chat sidebar
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
            Auto-claim on
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginBottom: 20,
          }}
        >
          {["streamer_fan: PogChamp", "viewer42: <3 <3 <3", "drop_watcher: let's go"].map(
            (msg, i) => {
              const msgIn = spring({
                frame: Math.max(0, frame - i * 6),
                fps,
                config: { damping: 16, stiffness: 140 },
              });
              return (
                <div
                  key={msg}
                  style={{
                    opacity: msgIn,
                    transform: `translateX(${interpolate(msgIn, [0, 1], [-10, 0])}px)`,
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    fontSize: 14,
                    color: "rgba(255,255,255,0.62)",
                  }}
                >
                  {msg}
                </div>
              );
            }
          )}
        </div>

        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.07)",
            marginBottom: 20,
          }}
        />

        <div
          style={{
            opacity: buttonPop,
            transform: `scale(${interpolate(buttonPop, [0, 1], [0.85, 1])}) translateY(${interpolate(buttonPop, [0, 1], [16, 0])}px)`,
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
              marginBottom: 12,
            }}
          >
            Bonus available
          </div>

          <div
            style={{
              padding: "18px 22px",
              borderRadius: 18,
              background: `linear-gradient(135deg, rgba(145,70,255,${interpolate(buttonBg, [0, 1], [0.15, 0.9])}), rgba(119,44,232,${interpolate(buttonBg, [0, 1], [0.1, 0.8])}))`,
              border: `1px solid rgba(145,70,255,${interpolate(buttonBg, [0, 1], [0.3, 0.7])})`,
              boxShadow: `0 14px 34px rgba(145,70,255,${interpolate(buttonBg, [0, 1], [0.1, 0.3])})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: `scale(${interpolate(clickEffect, [0, 1], [1, 1.15])})`,
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={interpolate(clickEffect, [0, 1], [0, 1]) > 0.5 ? "#bbf7d0" : "white"}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {clickEffect > 0.5 ? (
                    <path d="M5 13l4 4L19 7" />
                  ) : (
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  )}
                </svg>
              </div>
              <div>
                <div
                  style={{
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    fontSize: 16,
                    fontWeight: 800,
                    color: "white",
                  }}
                >
                  {buttonLabel}
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    fontSize: 12,
                    color: "rgba(255,255,255,0.55)",
                  }}
                >
                  Channel points reward
                </div>
              </div>
            </div>
            <div
              style={{
                opacity: interpolate(clickEffect, [0, 0.5], [1, 0]),
                padding: "8px 16px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.12)",
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: 13,
                fontWeight: 700,
                color: "white",
              }}
            >
              Claim
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            opacity: claimedBadge,
            transform: `translateY(${interpolate(claimedBadge, [0, 1], [12, 0])}px)`,
            padding: "10px 16px",
            borderRadius: 12,
            background: "rgba(34,197,94,0.10)",
            border: "1px solid rgba(34,197,94,0.22)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#86efac" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
          <span
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 13,
              fontWeight: 600,
              color: "#bbf7d0",
            }}
          >
            Bonus claimed automatically
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
